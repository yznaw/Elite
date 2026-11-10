using System;
using System.IO;

namespace EliteCardBridge
{
    /// <summary>
    /// Elite Card Bridge: lets the browser POS drive the QNB card terminal.
    /// Data (config, journal, logs) lives in %ProgramData%\ElitePOS\card-bridge
    /// on Windows, or ELITE_CARD_DATA_DIR when set.
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args)
        {
            var dataDirectory = Environment.GetEnvironmentVariable("ELITE_CARD_DATA_DIR");
            if (string.IsNullOrWhiteSpace(dataDirectory))
            {
                dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ElitePOS", "card-bridge");
            }
            var options = BridgeHost.LoadOptions(dataDirectory);
            options.Version = typeof(Program).Assembly.GetName().Version.ToString(3);
            if (Array.IndexOf(args, "--simulator") >= 0) options.Mode = "simulator";

            if (string.IsNullOrWhiteSpace(options.BridgeKey))
            {
                Console.Error.WriteLine("No bridge key configured. Run install-windows.ps1, or set ELITE_CARD_BRIDGE_KEY for a dev run.");
                return 1;
            }

            return BridgeHost.Run(options, (opts, log) =>
            {
                if (opts.Mode == "simulator") return new SimulatedTerminal();
#if QNB_DLL
                return new QnbTerminal(opts.ComPort, log);
#else
                throw new InvalidOperationException("This build has no QNB DLL. Copy the DLL package into tools/elite-card-bridge/lib and rebuild for Windows, or run with --simulator.");
#endif
            });
        }
    }
}
