using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;

namespace EliteCardBridge
{
    /// <summary>
    /// Stand-in for the QNB terminal so the POS can be built and tested
    /// without bank hardware. The next scenario is set through
    /// POST /v1/sim/next (simulator mode only). Each scenario mimics what the
    /// real DLL returns, including the messages a cashier would see.
    /// </summary>
    public class SimulatedTerminal : ITerminal
    {
        public static readonly string[] Scenarios =
        {
            "approve", "decline", "insufficient", "wrong_pin", "cancel", "card_timeout", "pin_timeout",
            "not_logged_on", "port_lost", "dll_timeout", "approve_no_auth", "out_of_paper", "no_host",
        };

        readonly object sync = new object();
        readonly Dictionary<string, int> statuses = new Dictionary<string, int>();
        readonly Queue<string> next = new Queue<string>();
        bool loggedOn = true;
        int sequence = 1000;
        int invoice = 1;

        public int StepDelayMs { get; set; } = 700;
        public string Mode => "simulator";
        public string DllVersion => "simulator";
        public string Port { get; private set; } = "SIM";
        public bool Connected { get; private set; }

        public void QueueScenario(string scenario)
        {
            if (Array.IndexOf(Scenarios, scenario) < 0) throw new ArgumentException("Unknown scenario.");
            lock (sync) next.Enqueue(scenario);
        }

        public int Connect() { Connected = true; return ErrorMap.OK; }
        public void Reconfigure(string port) { Port = port; }
        public IList<string> AvailablePorts() => new[] { "SIM" };

        public int Status(string utn)
        {
            lock (sync)
            {
                return statuses.TryGetValue(Formatting.BaseUtn(utn), out var code) ? code : ErrorMap.ERROR_TNF;
            }
        }

        string Take()
        {
            lock (sync) return next.Count > 0 ? next.Dequeue() : "approve";
        }

        void Say(Action<TerminalMessage> onMessage, string title, params string[] lines)
        {
            onMessage(Formatting.Message(title, lines));
            if (StepDelayMs > 0) Thread.Sleep(StepDelayMs);
        }

        public TerminalResponse Execute(JobRequest request, string utn, Action<TerminalMessage> onMessage, Action<string> onReceipt)
        {
            switch (request.Type)
            {
                case JobTypes.Logon: loggedOn = true; return Ok(new TerminalTags { LoggedOn = "true" });
                case JobTypes.Logoff: loggedOn = false; return Ok(new TerminalTags { LoggedOn = "false" });
                case JobTypes.Settings:
                    return Ok(new TerminalTags { TerminalModel = "SIMULATOR", TerminalSerial = "SIM0001", AppVersion = "QNBN910_sim", LoggedOn = loggedOn ? "true" : "false", Tid = "23323344", Mid = "712902260600600" });
                case JobTypes.CloseBatch:
                    onReceipt("      CLOSE BATCH REPORT\n  SIMULATED TERMINAL\nTOTAL                  OK\n\f");
                    return Ok(new TerminalTags { BatchEmpty = "false" });
                case JobTypes.Summary: case JobTypes.Audit: case JobTypes.ReprintLast: case JobTypes.ReprintInvoice:
                case JobTypes.Initialize: case JobTypes.Restart:
                    return Ok(new TerminalTags());
            }

            var scenario = Take();
            var baseUtn = Formatting.BaseUtn(utn);
            if (request.Type == JobTypes.Void)
            {
                // Like the terminal: only a sale it approved can be voided.
                lock (sync)
                {
                    if (!statuses.TryGetValue(Formatting.BaseUtn(request.OriginalUtn), out var original) || original != ErrorMap.ERROR_TXN_APPROVED)
                    {
                        return Fail(ErrorMap.ERROR_TNF);
                    }
                    statuses[Formatting.BaseUtn(request.OriginalUtn)] = ErrorMap.ERROR_TXN_WILL_REVERSED;
                }
            }
            lock (sync) statuses[baseUtn] = ErrorMap.ERROR_TXN_WILL_REVERSED;

            if (!loggedOn || scenario == "not_logged_on")
            {
                loggedOn = false;
                return Fail(ErrorMap.ERROR_TNL);
            }
            Say(onMessage, "001 SWIPE/INSERT/TAP CARD", "QAR " + Formatting.Amount(request.AmountCents), "", "", "");
            switch (scenario)
            {
                case "cancel": return Done(baseUtn, Fail(ErrorMap.ERROR_TXN_CANCELLED_BY_USER));
                case "card_timeout": return Done(baseUtn, Fail(ErrorMap.ERROR_TIMEOUT_CARDENTRY));
                case "out_of_paper": return Done(baseUtn, Fail(ErrorMap.ERROR_OUT_OF_PAPER));
            }
            Say(onMessage, "003 Enter Online PIN", "", "", "", "");
            if (scenario == "pin_timeout") return Done(baseUtn, Fail(ErrorMap.ERROR_TIMEOUT_PINENTRY));
            Say(onMessage, "002 Processing...", "", "", "", "");
            switch (scenario)
            {
                case "no_host": return Done(baseUtn, Fail(ErrorMap.ERROR_NPL));
                case "decline": return Done(baseUtn, Fail(ErrorMap.ERROR_DCL, "050"));
                case "insufficient": return Done(baseUtn, Fail(ErrorMap.ERROR_DCL, "116"));
                case "wrong_pin": return Done(baseUtn, Fail(ErrorMap.ERROR_DCL, "055"));
                case "port_lost":
                    // The bank approved, then the cable dropped before the POS
                    // got the answer: the terminal keeps it as approved.
                    lock (sync) statuses[baseUtn] = ErrorMap.ERROR_TXN_APPROVED;
                    return new TerminalResponse { ErrorCode = ErrorMap.ERROR_PORT_CONNECTION, Tags = new TerminalTags() };
                case "dll_timeout":
                    lock (sync) statuses[baseUtn] = ErrorMap.ERROR_TXN_WILL_REVERSED;
                    return new TerminalResponse { ErrorCode = ErrorMap.ERROR_DLL_TIME_OUT, Tags = new TerminalTags() };
            }

            Say(onMessage, "005 Please Remove Card", "", "", "", "");
            var seq = Interlocked.Increment(ref sequence).ToString("000000000", CultureInfo.InvariantCulture);
            var inv = Interlocked.Increment(ref invoice).ToString("000000", CultureInfo.InvariantCulture);
            var auth = scenario == "approve_no_auth" ? "" : DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture);
            var label = request.Type == JobTypes.Sale ? "SALE" : request.Type == JobTypes.Void ? "VOID" : "REFUND";
            onReceipt(
                "\u001e        SIMULATED RECEIPT\n" +
                "TID:23323344      MID:712902260600600\n" +
                "\u001eMASTERCARD\n\u001e************0293\n" +
                label + "                           EXP.:06/27\n" +
                "SEQ. NO:" + seq + "      INVOICE:" + inv + "\n" +
                "RESPONSE CODE:000          AUTH NO :" + auth + "\nApproved\n" +
                "\u001eTOTAL:                  QAR " + Formatting.Amount(request.AmountCents) + "\n" +
                "\u0022\nNO PIN REQUIRED\n_______ CUSTOMER COPY _______\n\f");
            var tags = new TerminalTags
            {
                Result = "true", HostResponseCode = "000", AuthCode = auth, Pan = "521234XXXXXX0293FFFFF", Expiry = "0627",
                Issuer = "MASTERCARD", Tid = "23323344", Mid = "712902260600600",
                Date = DateTime.Now.ToString("ddMMyy", CultureInfo.InvariantCulture), Time = DateTime.Now.ToString("HHmmss", CultureInfo.InvariantCulture),
                SeqNo = seq, InvoiceNo = inv, HostTrace = seq.Substring(3), EntryMethod = "CHIP", PinVerified = "true", EchoUtn = baseUtn,
                Amount = Formatting.Amount(request.AmountCents),
            };
            return Done(baseUtn, new TerminalResponse { ErrorCode = ErrorMap.OK, Tags = tags }, ErrorMap.ERROR_TXN_APPROVED);
        }

        TerminalResponse Done(string baseUtn, TerminalResponse response, int status = ErrorMap.ERROR_TXN_DECLINE)
        {
            lock (sync) statuses[baseUtn] = status;
            return response;
        }

        static TerminalResponse Ok(TerminalTags tags) => new TerminalResponse { ErrorCode = ErrorMap.OK, Tags = tags };
        static TerminalResponse Fail(int code, string host = null) => new TerminalResponse { ErrorCode = code, Tags = new TerminalTags { HostResponseCode = host } };
    }
}
