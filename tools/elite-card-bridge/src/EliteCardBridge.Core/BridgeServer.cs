using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EliteCardBridge
{
    public class BridgeOptions
    {
        public int HttpPort { get; set; } = 8183;
        public string ComPort { get; set; } = "COM1";
        /// <summary>Shared secret the POS sends as X-Elite-Bridge-Key. Set at install.</summary>
        public string BridgeKey { get; set; }
        public string[] AllowedOrigins { get; set; } = { "http://localhost:4300", "https://admin.elitecollections.qa" };
        public string DataDirectory { get; set; }
        /// <summary>"real" (QNB DLL) or "simulator".</summary>
        public string Mode { get; set; } = "real";
        public string Version { get; set; } = "1.0.0";
    }

    /// <summary>
    /// Loopback HTTP API the POS browser talks to. Binds 127.0.0.1 only,
    /// accepts only the Elite admin origins, and requires the bridge key on
    /// everything except /v1/health.
    /// </summary>
    public class BridgeServer : IDisposable
    {
        const int MaxBodyBytes = 16 * 1024;
        readonly BridgeOptions options;
        readonly ITerminal terminal;
        readonly JobRunner runner;
        readonly Log log;
        readonly HttpListener listener = new HttpListener();
        readonly HashSet<string> origins;
        readonly byte[] keyHash;
        CancellationTokenSource stop;

        public BridgeServer(BridgeOptions options, ITerminal terminal, JobRunner runner, Log log)
        {
            if (string.IsNullOrWhiteSpace(options.BridgeKey) || options.BridgeKey.Length < 24)
            {
                throw new ArgumentException("A bridge key of at least 24 characters is required.");
            }
            this.options = options;
            this.terminal = terminal;
            this.runner = runner;
            this.log = log;
            origins = new HashSet<string>(options.AllowedOrigins ?? new string[0], StringComparer.OrdinalIgnoreCase);
            keyHash = Sha256(options.BridgeKey);
            listener.Prefixes.Add("http://127.0.0.1:" + options.HttpPort + "/");
        }

        public void Start()
        {
            listener.Start();
            stop = new CancellationTokenSource();
            Task.Run(() => Loop(stop.Token));
            log.Info("bridge_started", new { port = options.HttpPort, mode = terminal.Mode, comPort = terminal.Port, version = options.Version });
        }

        public void Dispose()
        {
            stop?.Cancel();
            if (listener.IsListening) listener.Stop();
            listener.Close();
        }

        async Task Loop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                HttpListenerContext context;
                try { context = await listener.GetContextAsync().ConfigureAwait(false); }
                catch (Exception) when (token.IsCancellationRequested) { return; }
                catch (HttpListenerException) { return; }
                catch (ObjectDisposedException) { return; }
                _ = Task.Run(() => Handle(context));
            }
        }

        void Handle(HttpListenerContext context)
        {
            var req = context.Request;
            var res = context.Response;
            try
            {
                var origin = req.Headers["Origin"];
                var originAllowed = origin != null && origins.Contains(origin);
                if (originAllowed)
                {
                    res.Headers["Access-Control-Allow-Origin"] = origin;
                    res.Headers["Vary"] = "Origin";
                    res.Headers["Access-Control-Allow-Headers"] = "content-type, x-elite-bridge-key";
                    res.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS";
                    res.Headers["Access-Control-Max-Age"] = "600";
                    // Chrome Private Network Access: an https page calling
                    // 127.0.0.1 needs this on the preflight.
                    if (req.Headers["Access-Control-Request-Private-Network"] == "true")
                    {
                        res.Headers["Access-Control-Allow-Private-Network"] = "true";
                    }
                }
                if (origin != null && !originAllowed)
                {
                    log.Warn("origin_denied", new { origin, path = req.Url.AbsolutePath });
                    Send(res, 403, Error("ORIGIN_DENIED", "Origin not allowed."));
                    return;
                }
                if (req.HttpMethod == "OPTIONS") { Send(res, 204, null); return; }

                var path = req.Url.AbsolutePath.TrimEnd('/');
                if (req.HttpMethod == "GET" && path == "/v1/health") { Send(res, 200, Ok(Health())); return; }

                if (!KeyValid(req.Headers["X-Elite-Bridge-Key"]))
                {
                    log.Warn("key_denied", new { path, origin });
                    Send(res, 401, Error("BRIDGE_KEY_INVALID", "The card bridge key is missing or wrong. Re-enter it in POS Settings."));
                    return;
                }
                Route(req, res, path);
            }
            catch (BridgeError error)
            {
                Send(res, error.Status, Error(error.Code, error.Message));
            }
            catch (JsonException)
            {
                Send(res, 400, Error("BODY_INVALID", "Request body is not valid JSON."));
            }
            catch (Exception error)
            {
                log.Error("request_failed", new { path = req.Url.AbsolutePath, error = error.Message });
                Send(res, 500, Error("BRIDGE_ERROR", "The card bridge hit an unexpected error."));
            }
        }

        void Route(HttpListenerRequest req, HttpListenerResponse res, string path)
        {
            var segments = path.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            // /v1/jobs
            if (req.HttpMethod == "POST" && path == "/v1/jobs")
            {
                var request = Read<JobRequest>(req);
                var job = runner.Submit(request);
                log.Info("job_started", new { type = request.Type, utn = request.Utn, amountCents = request.AmountCents });
                Send(res, 202, Ok(JobView(job)));
                return;
            }
            // /v1/jobs/{id}
            if (req.HttpMethod == "GET" && segments.Length == 3 && segments[1] == "jobs")
            {
                var job = runner.Get(segments[2]) ?? throw new BridgeError(404, "JOB_NOT_FOUND", "Job not found (the bridge may have restarted). Check the payment status by UTN.");
                Send(res, 200, Ok(JobView(job)));
                return;
            }
            // /v1/jobs/{id}/cancel: DLL 5.0.0.13 has no break command.
            if (req.HttpMethod == "POST" && segments.Length == 4 && segments[1] == "jobs" && segments[3] == "cancel")
            {
                throw new BridgeError(409, "CANCEL_ON_TERMINAL", "Press the red Cancel key on the card machine to cancel.");
            }
            // /v1/transactions/{utn}
            if (req.HttpMethod == "GET" && segments.Length == 3 && segments[1] == "transactions")
            {
                Send(res, 200, Ok(runner.Status(segments[2].ToUpperInvariant())));
                return;
            }
            if (req.HttpMethod == "GET" && path == "/v1/ports")
            {
                Send(res, 200, Ok(new { ports = terminal.AvailablePorts(), current = terminal.Port }));
                return;
            }
            if (req.HttpMethod == "PUT" && path == "/v1/config")
            {
                var body = Read<Dictionary<string, string>>(req);
                if (!body.TryGetValue("comPort", out var port) || !System.Text.RegularExpressions.Regex.IsMatch(port ?? "", "^COM[0-9]{1,3}$|^SIM$"))
                {
                    throw new BridgeError(422, "PORT_INVALID", "comPort must look like COM3.");
                }
                if (runner.Busy) throw new BridgeError(409, "TERMINAL_BUSY", "Wait for the current operation to finish.");
                terminal.Reconfigure(port);
                options.ComPort = port;
                if (options.DataDirectory != null) BridgeHost.SaveOptions(options);
                log.Info("port_changed", new { port });
                Send(res, 200, Ok(Health()));
                return;
            }
            if (req.HttpMethod == "POST" && path == "/v1/sim/next")
            {
                if (!(terminal is SimulatedTerminal sim)) throw new BridgeError(404, "NOT_FOUND", "Not found.");
                var body = Read<Dictionary<string, string>>(req);
                try { sim.QueueScenario(body.TryGetValue("scenario", out var s) ? s : ""); }
                catch (ArgumentException) { throw new BridgeError(422, "SCENARIO_INVALID", "Unknown scenario. Use one of: " + string.Join(", ", SimulatedTerminal.Scenarios)); }
                Send(res, 200, Ok(new { queued = body["scenario"] }));
                return;
            }
            throw new BridgeError(404, "NOT_FOUND", "Not found.");
        }

        object Health() => new
        {
            service = "elite-card-bridge",
            version = options.Version,
            mode = terminal.Mode,
            dllVersion = terminal.DllVersion,
            comPort = terminal.Port,
            connected = terminal.Connected,
            busy = runner.Busy,
        };

        static object JobView(Job job) => new
        {
            jobId = job.Id,
            type = job.Request.Type,
            utn = job.Request.Utn,
            state = job.State,
            message = job.Message,
            result = job.Result,
        };

        bool KeyValid(string provided)
        {
            if (string.IsNullOrEmpty(provided)) return false;
            var hash = Sha256(provided);
            var diff = 0;
            for (var i = 0; i < hash.Length; i++) diff |= hash[i] ^ keyHash[i];
            return diff == 0;
        }

        static byte[] Sha256(string value)
        {
            using (var sha = SHA256.Create()) return sha.ComputeHash(Encoding.UTF8.GetBytes(value));
        }

        static T Read<T>(HttpListenerRequest req) where T : class
        {
            if (req.ContentLength64 > MaxBodyBytes) throw new BridgeError(413, "BODY_TOO_LARGE", "Request body too large.");
            using (var reader = new StreamReader(req.InputStream, Encoding.UTF8))
            {
                var buffer = new char[MaxBodyBytes + 1];
                var read = reader.ReadBlock(buffer, 0, buffer.Length);
                if (read > MaxBodyBytes) throw new BridgeError(413, "BODY_TOO_LARGE", "Request body too large.");
                var text = new string(buffer, 0, read);
                return JsonSerializer.Deserialize<T>(string.IsNullOrWhiteSpace(text) ? "{}" : text, Json.Options)
                    ?? throw new BridgeError(400, "BODY_INVALID", "Request body is required.");
            }
        }

        static object Ok(object data) => new { success = true, data };
        static object Error(string code, string message) => new { success = false, code, message };

        static void Send(HttpListenerResponse res, int status, object body)
        {
            try
            {
                res.StatusCode = status;
                res.Headers["Cache-Control"] = "no-store";
                if (body != null)
                {
                    var bytes = JsonSerializer.SerializeToUtf8Bytes(body, Json.Options);
                    res.ContentType = "application/json; charset=utf-8";
                    res.ContentLength64 = bytes.Length;
                    res.OutputStream.Write(bytes, 0, bytes.Length);
                }
            }
            finally
            {
                res.Close();
            }
        }
    }
}
