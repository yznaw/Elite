using System;
using System.IO;
using System.Text.Json;
using System.Threading;

namespace EliteCardBridge
{
    /// <summary>Startup shared by the Windows bridge and the dev/simulator build.</summary>
    public static class BridgeHost
    {
        /// <summary>
        /// Reads config.json from the data directory, then applies
        /// ELITE_CARD_* environment overrides (used by tests and dev runs).
        /// </summary>
        public static BridgeOptions LoadOptions(string dataDirectory)
        {
            Directory.CreateDirectory(dataDirectory);
            var configPath = Path.Combine(dataDirectory, "config.json");
            var options = File.Exists(configPath)
                ? JsonSerializer.Deserialize<BridgeOptions>(File.ReadAllText(configPath), Json.Options) ?? new BridgeOptions()
                : new BridgeOptions();
            options.DataDirectory = dataDirectory;
            Env("ELITE_CARD_COM_PORT", v => options.ComPort = v);
            Env("ELITE_CARD_BRIDGE_KEY", v => options.BridgeKey = v);
            Env("ELITE_CARD_TERMINAL", v => options.Mode = v);
            Env("ELITE_CARD_HTTP_PORT", v => options.HttpPort = int.Parse(v));
            Env("ELITE_CARD_ALLOWED_ORIGINS", v => options.AllowedOrigins = v.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries));
            for (var i = 0; i < options.AllowedOrigins.Length; i++) options.AllowedOrigins[i] = options.AllowedOrigins[i].Trim();
            return options;
        }

        /// <summary>Persists the chosen COM port so it survives a restart.</summary>
        public static void SaveOptions(BridgeOptions options)
        {
            var configPath = Path.Combine(options.DataDirectory, "config.json");
            var copy = new BridgeOptions
            {
                HttpPort = options.HttpPort, ComPort = options.ComPort, BridgeKey = options.BridgeKey,
                AllowedOrigins = options.AllowedOrigins, Mode = options.Mode,
            };
            File.WriteAllText(configPath, JsonSerializer.Serialize(copy, new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
        }

        public static int Run(BridgeOptions options, Func<BridgeOptions, Log, ITerminal> createTerminal)
        {
            var log = new Log(Path.Combine(options.DataDirectory, "logs"));
            ITerminal terminal;
            try
            {
                terminal = createTerminal(options, log);
            }
            catch (Exception error)
            {
                log.Error("terminal_unavailable", new { error = error.Message });
                return 2;
            }
            var journal = new Journal(Path.Combine(options.DataDirectory, "journal"));
            foreach (var entry in journal.InFlight())
            {
                // A payment the bridge sent but never got an answer for (crash or
                // power cut). The POS will ask for its status by UTN.
                log.Warn("in_flight_after_restart", new { utn = entry.Utn, type = entry.Type, amountCents = entry.AmountCents });
            }
            var runner = new JobRunner(terminal, journal, log);
            using (var server = new BridgeServer(options, terminal, runner, log))
            using (var done = new ManualResetEventSlim(false))
            {
                server.Start();
                var connect = terminal.Connect();
                log.Info("terminal_connect", new { result = connect, port = terminal.Port });
                Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
                done.Wait();
                log.Info("bridge_stopped");
            }
            return 0;
        }

        static void Env(string name, Action<string> apply)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrWhiteSpace(value)) apply(value.Trim());
        }
    }
}
