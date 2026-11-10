using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Linq;
using Xunit;

namespace EliteCardBridge.Tests
{
    public class FormattingTests
    {
        [Theory]
        [InlineData(5000, "50.00")]
        [InlineData(5, "0.05")]
        [InlineData(1234567, "12345.67")]
        public void Amount_is_decimal_string(long cents, string expected) => Assert.Equal(expected, Formatting.Amount(cents));

        [Fact]
        public void Amount12_is_twelve_digit_implied_decimals() => Assert.Equal("000000055000", Formatting.Amount12(55000));

        [Fact]
        public void Amount_rejects_zero_and_overflow()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => Formatting.Amount(0));
            Assert.Throws<ArgumentOutOfRangeException>(() => Formatting.Amount(Formatting.MaxAmountCents + 1));
        }

        [Fact]
        public void Utn_needs_retry_digit_and_retry_bumps_it()
        {
            Assert.True(Formatting.IsUtn("EAB12C2610011230450010"));
            Assert.False(Formatting.IsUtn("EAB12C261001123045001A"));
            Assert.False(Formatting.IsUtn("eab12c2610011230450010"));
            Assert.False(Formatting.IsUtn("EAB12C26100112304500100"));
            Assert.Equal("EAB12C2610011230450011", Formatting.NextRetry("EAB12C2610011230450010"));
            Assert.Equal("EAB12C2610011230450010", Formatting.NextRetry("EAB12C2610011230450019"));
            Assert.Equal("EAB12C261001123045001", Formatting.BaseUtn("EAB12C2610011230450010"));
        }

        [Fact]
        public void SeqNo_is_left_padded_and_dates_checked()
        {
            Assert.Equal("0001001005", Formatting.SeqNo("001001005"));
            Assert.Throws<ArgumentException>(() => Formatting.SeqNo("12A"));
            Assert.True(Formatting.IsDdMmYy("190226"));
            Assert.False(Formatting.IsDdMmYy("320126"));
        }

        [Fact]
        public void Pan_masking_and_detection()
        {
            Assert.Equal("452338XXXXXX7969", Formatting.MaskedPan("452338XXXXXX7969FFFFF"));
            Assert.Equal("452338XXXXXX7969", Formatting.MaskedPan("452338******7969"));
            Assert.Null(Formatting.MaskedPan("4111111111111111"));
            Assert.True(Formatting.ContainsPan("card 4111 1111 1111 1111"));
            Assert.False(Formatting.ContainsPan("MID:712902260600600 TID:23323344"));
            Assert.Equal("card 411111XXXXXX1111", Formatting.Redact("card 4111111111111111"));
        }

        [Fact]
        public void Display_code_is_stripped_from_terminal_messages()
        {
            var message = Formatting.Message("001 SWIPE/INSERT/TAP CARD", new[] { "QAR 50.00", "", "", "" });
            Assert.Equal("001", message.Code);
            Assert.Equal("SWIPE/INSERT/TAP CARD", message.Title);
        }

        [Fact]
        public void TxnAt_parses_terminal_date_and_time_as_qatar_time()
        {
            Assert.Equal("2026-10-01T14:05:09+03:00", Formatting.TxnAt("011026", "140509"));
            Assert.Null(Formatting.TxnAt("", ""));
        }
    }

    public class ResultMapperTests
    {
        static JobRequest Sale() => new JobRequest { Type = JobTypes.Sale, Utn = "EAB12C2610011230450010", AmountCents = 5000 };

        [Fact]
        public void Approved_sale_keeps_only_masked_card_data()
        {
            var tags = new TerminalTags { AuthCode = "114857", Pan = "521234XXXXXX0293FFFFF", Expiry = "0625", Issuer = "MASTERCARD", HostResponseCode = "000" };
            var result = ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = 0, Tags = tags }, "AUTH NO :114857");
            Assert.Equal(Outcomes.Approved, result.Outcome);
            Assert.Equal("521234XXXXXX0293", result.MaskedPan);
            Assert.Equal("114857", result.AuthCode);
        }

        [Fact]
        public void Receipt_with_a_full_pan_is_dropped()
        {
            var tags = new TerminalTags { AuthCode = "114857" };
            var result = ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = 0, Tags = tags }, "CARD 4111111111111111");
            Assert.Null(result.ReceiptText);
        }

        [Fact]
        public void Approval_without_auth_code_is_unknown()
        {
            var result = ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = 0, Tags = new TerminalTags() }, null);
            Assert.Equal(Outcomes.Unknown, result.Outcome);
        }

        [Theory]
        [InlineData(ErrorMap.ERROR_DCL, "declined")]
        [InlineData(ErrorMap.ERROR_TXN_CANCELLED_BY_USER, "cancelled")]
        [InlineData(ErrorMap.ERROR_PORT_CONNECTION, "unknown")]
        [InlineData(ErrorMap.ERROR_DLL_TIME_OUT, "unknown")]
        [InlineData(ErrorMap.ERROR_LOG_FILE_NOT_CREATED, "error")]
        [InlineData(99, "unknown")]
        public void Error_codes_map_to_money_outcomes(int code, string outcome)
        {
            Assert.Equal(outcome, ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = code }, null).Outcome);
        }

        [Fact]
        public void Host_code_gives_a_plain_reason()
        {
            var result = ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = ErrorMap.ERROR_DCL, Tags = new TerminalTags { HostResponseCode = "116" } }, null);
            Assert.Equal("Insufficient funds.", result.Message);
        }

        [Fact]
        public void Exception_mid_sale_is_unknown_never_declined()
        {
            Assert.Equal(Outcomes.Unknown, ResultMapper.Map(Sale(), new TerminalResponse { ErrorCode = -1, Exception = "IOException" }, null).Outcome);
        }

        [Fact]
        public void Empty_batch_close_is_ok()
        {
            var result = ResultMapper.Map(new JobRequest { Type = JobTypes.CloseBatch }, new TerminalResponse { ErrorCode = ErrorMap.ERROR_NOBATCH_AVAILABLE }, null);
            Assert.Equal(Outcomes.Ok, result.Outcome);
        }
    }

    public class RunnerTests : IDisposable
    {
        readonly string dir = Path.Combine(Path.GetTempPath(), "ecb-" + Guid.NewGuid().ToString("N"));
        public void Dispose() { try { Directory.Delete(dir, true); } catch (IOException) { } }

        (JobRunner runner, SimulatedTerminal sim, Journal journal) Make()
        {
            var sim = new SimulatedTerminal { StepDelayMs = 0 };
            var journal = new Journal(Path.Combine(dir, "journal"));
            var log = new Log(Path.Combine(dir, "logs")) { Echo = false };
            return (new JobRunner(sim, journal, log), sim, journal);
        }

        static Job Wait(JobRunner runner, Job job)
        {
            for (var i = 0; i < 200 && runner.Get(job.Id).State != "done"; i++) Thread.Sleep(10);
            return runner.Get(job.Id);
        }

        static JobRequest Sale(string utn = "EAB12C2610011230450010", long cents = 5000) => new JobRequest { Type = JobTypes.Sale, Utn = utn, AmountCents = cents };

        [Fact]
        public void Approved_sale_is_journaled_and_replayed_not_recharged()
        {
            var (runner, _, journal) = Make();
            var first = Wait(runner, runner.Submit(Sale()));
            Assert.Equal(Outcomes.Approved, first.Result.Outcome);
            Assert.Equal("done", journal.Find("EAB12C261001123045001").State);

            var replay = runner.Submit(Sale());
            Assert.Equal("done", replay.State);
            Assert.Equal(first.Result.AuthCode, replay.Result.AuthCode);
            Assert.Throws<BridgeError>(() => runner.Submit(Sale(cents: 4000)));
        }

        [Fact]
        public void Not_logged_on_triggers_logon_and_retry()
        {
            var (runner, sim, _) = Make();
            sim.QueueScenario("not_logged_on");
            var job = Wait(runner, runner.Submit(Sale()));
            Assert.Equal(Outcomes.Approved, job.Result.Outcome);
        }

        [Fact]
        public void Lost_cable_is_unknown_then_status_says_approved()
        {
            var (runner, sim, _) = Make();
            sim.QueueScenario("port_lost");
            var job = Wait(runner, runner.Submit(Sale()));
            Assert.Equal(Outcomes.Unknown, job.Result.Outcome);
            Assert.Equal("approved", runner.Status("EAB12C2610011230450010").Status);
        }

        [Fact]
        public void Status_of_a_never_sent_utn_is_not_found()
        {
            var (runner, _, _) = Make();
            Assert.Equal("not_found", runner.Status("EZZZZZ9999999999999990").Status);
        }

        [Fact]
        public void Second_operation_while_busy_is_refused()
        {
            var (runner, sim, _) = Make();
            sim.StepDelayMs = 200;
            runner.Submit(Sale());
            var error = Assert.Throws<BridgeError>(() => runner.Submit(Sale("EAB12C2610011230450020")));
            Assert.Equal("TERMINAL_BUSY", error.Code);
        }

        [Fact]
        public void Journal_survives_restart_and_flags_in_flight()
        {
            var (_, _, journal) = Make();
            journal.Sent("EAAAAA261001123045001", Sale());
            var reopened = new Journal(Path.Combine(dir, "journal"));
            Assert.Single(reopened.InFlight());
            var runner = new JobRunner(new SimulatedTerminal { StepDelayMs = 0 }, reopened, new Log(Path.Combine(dir, "logs")) { Echo = false });
            var error = Assert.Throws<BridgeError>(() => runner.Submit(Sale("EAAAAA2610011230450010")));
            Assert.Equal("UTN_IN_FLIGHT", error.Code);
        }

        [Fact]
        public void Void_targets_the_original_sale_utn()
        {
            var (runner, _, _) = Make();
            var sale = Wait(runner, runner.Submit(Sale()));
            Assert.Equal(Outcomes.Approved, sale.Result.Outcome);
            var bad = new JobRequest { Type = JobTypes.Void, Utn = "EAB12C2610011230450050", AmountCents = 5000 };
            Assert.Equal("ORIGINAL_UTN_INVALID", Assert.Throws<BridgeError>(() => runner.Submit(bad)).Code);
            bad.OriginalUtn = "EAB12C2610011230450010";
            Assert.Equal(Outcomes.Approved, Wait(runner, runner.Submit(bad)).Result.Outcome);
            var again = new JobRequest { Type = JobTypes.Void, Utn = "EAB12C2610011230450060", AmountCents = 5000, OriginalUtn = "EAB12C2610011230450010" };
            Assert.Equal(Outcomes.Declined, Wait(runner, runner.Submit(again)).Result.Outcome);
        }

        [Fact]
        public void Refund_requires_original_details()
        {
            var (runner, _, _) = Make();
            var request = new JobRequest { Type = JobTypes.Refund, Utn = "EAB12C2610011230450030", AmountCents = 5000 };
            Assert.Equal("ORIGINAL_REQUIRED", Assert.Throws<BridgeError>(() => runner.Submit(request)).Code);
            request.Original = new OriginalTransaction { SeqNo = "001001005", Date = "011026", AuthCode = "114857", AmountCents = 5000 };
            Assert.Equal(Outcomes.Approved, Wait(runner, runner.Submit(request)).Result.Outcome);
        }
    }

    public class ServerTests : IDisposable
    {
        const string Key = "test-bridge-key-0123456789abcdef";
        const string Origin = "https://admin.elitecollections.qa";
        readonly string dir = Path.Combine(Path.GetTempPath(), "ecb-" + Guid.NewGuid().ToString("N"));
        readonly BridgeServer server;
        readonly HttpClient http = new HttpClient();
        readonly string baseUrl;

        public ServerTests()
        {
            var port = FreePort();
            baseUrl = "http://127.0.0.1:" + port;
            var sim = new SimulatedTerminal { StepDelayMs = 0 };
            var log = new Log(Path.Combine(dir, "logs")) { Echo = false };
            var options = new BridgeOptions { HttpPort = port, BridgeKey = Key, Mode = "simulator" };
            server = new BridgeServer(options, sim, new JobRunner(sim, new Journal(Path.Combine(dir, "journal")), log), log);
            server.Start();
        }

        public void Dispose()
        {
            server.Dispose();
            http.Dispose();
            try { Directory.Delete(dir, true); } catch (IOException) { }
        }

        static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            var port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        HttpRequestMessage Req(HttpMethod method, string path, string body = null, string key = Key, string origin = Origin)
        {
            var req = new HttpRequestMessage(method, baseUrl + path);
            if (key != null) req.Headers.Add("X-Elite-Bridge-Key", key);
            if (origin != null) req.Headers.Add("Origin", origin);
            if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
            return req;
        }

        async Task<JsonElement> Data(HttpResponseMessage res) => JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

        [Fact]
        public async Task Health_is_open_but_jobs_need_the_key()
        {
            var health = await http.SendAsync(Req(HttpMethod.Get, "/v1/health", key: null));
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);
            Assert.Equal(Origin, health.Headers.GetValues("Access-Control-Allow-Origin").Single());

            var noKey = await http.SendAsync(Req(HttpMethod.Post, "/v1/jobs", "{\"type\":\"logon\"}", key: null));
            Assert.Equal(HttpStatusCode.Unauthorized, noKey.StatusCode);
            var wrongKey = await http.SendAsync(Req(HttpMethod.Post, "/v1/jobs", "{\"type\":\"logon\"}", key: "wrong-key-wrong-key-wrong-key"));
            Assert.Equal(HttpStatusCode.Unauthorized, wrongKey.StatusCode);
        }

        [Fact]
        public async Task Foreign_origin_is_refused()
        {
            var res = await http.SendAsync(Req(HttpMethod.Get, "/v1/health", origin: "https://evil.example"));
            Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        }

        [Fact]
        public async Task Private_network_preflight_is_answered_for_allowed_origin()
        {
            var req = Req(HttpMethod.Options, "/v1/jobs", key: null);
            req.Headers.Add("Access-Control-Request-Private-Network", "true");
            req.Headers.Add("Access-Control-Request-Method", "POST");
            var res = await http.SendAsync(req);
            Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
            Assert.Equal("true", res.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
        }

        [Fact]
        public async Task Sale_job_runs_to_approval_and_status_reads_journal()
        {
            const string utn = "EAB12C2610011230450040";
            var start = await http.SendAsync(Req(HttpMethod.Post, "/v1/jobs", "{\"type\":\"sale\",\"utn\":\"" + utn + "\",\"amountCents\":5000}"));
            Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
            var jobId = (await Data(start)).GetProperty("data").GetProperty("jobId").GetString();

            JsonElement job = default;
            for (var i = 0; i < 100; i++)
            {
                job = (await Data(await http.SendAsync(Req(HttpMethod.Get, "/v1/jobs/" + jobId)))).GetProperty("data");
                if (job.GetProperty("state").GetString() == "done") break;
                await Task.Delay(20);
            }
            var result = job.GetProperty("result");
            Assert.Equal("approved", result.GetProperty("outcome").GetString());
            Assert.Equal("521234XXXXXX0293", result.GetProperty("maskedPan").GetString());

            var status = (await Data(await http.SendAsync(Req(HttpMethod.Get, "/v1/transactions/" + utn)))).GetProperty("data");
            Assert.Equal("approved", status.GetProperty("status").GetString());
            Assert.Equal("journal", status.GetProperty("source").GetString());
        }

        [Fact]
        public async Task Bad_input_is_rejected_with_a_code()
        {
            var res = await http.SendAsync(Req(HttpMethod.Post, "/v1/jobs", "{\"type\":\"sale\",\"utn\":\"bad\",\"amountCents\":5000}"));
            Assert.Equal((HttpStatusCode)422, res.StatusCode);
            Assert.Equal("UTN_INVALID", (await Data(res)).GetProperty("code").GetString());
            var big = await http.SendAsync(Req(HttpMethod.Post, "/v1/jobs", "{\"type\":\"logon\",\"pad\":\"" + new string('x', 20000) + "\"}"));
            Assert.Equal((HttpStatusCode)413, big.StatusCode);
        }

        [Fact]
        public async Task Simulator_scenario_can_be_queued()
        {
            var res = await http.SendAsync(Req(HttpMethod.Post, "/v1/sim/next", "{\"scenario\":\"decline\"}"));
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var bad = await http.SendAsync(Req(HttpMethod.Post, "/v1/sim/next", "{\"scenario\":\"explode\"}"));
            Assert.Equal((HttpStatusCode)422, bad.StatusCode);
        }
    }
}
