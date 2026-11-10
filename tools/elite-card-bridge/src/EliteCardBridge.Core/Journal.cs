using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace EliteCardBridge
{
    /// <summary>
    /// Append-only record of every money-moving terminal call, keyed by the
    /// base UTN (retry digit removed). A "sent" line is flushed to disk
    /// before the DLL is called and a "done" line after, so after a crash the
    /// bridge knows which payments were in flight and must be checked with
    /// TransactionStatus instead of being retried blindly.
    /// </summary>
    public class Journal
    {
        public class Entry
        {
            public string Utn { get; set; }
            public string State { get; set; }
            public string Type { get; set; }
            public long AmountCents { get; set; }
            public string At { get; set; }
            public BridgeResult Result { get; set; }
        }

        const long RotateBytes = 5L * 1024 * 1024;
        const int KeepFiles = 10;
        readonly string path;
        readonly object sync = new object();
        readonly Dictionary<string, Entry> latest = new Dictionary<string, Entry>(StringComparer.Ordinal);

        public Journal(string directory)
        {
            Directory.CreateDirectory(directory);
            path = Path.Combine(directory, "journal.log");
            Load();
        }

        void Load()
        {
            // Oldest first, so the newest record for a UTN wins.
            for (var i = KeepFiles; i >= 0; i--)
            {
                var file = i == 0 ? path : path + "." + i;
                if (!File.Exists(file)) continue;
                foreach (var line in File.ReadAllLines(file))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        var entry = JsonSerializer.Deserialize<Entry>(line, Json.Options);
                        if (entry?.Utn != null) latest[entry.Utn] = entry;
                    }
                    catch (JsonException)
                    {
                        // A torn last line from a power cut: skip it; the
                        // "sent" line before it still marks the UTN in flight.
                    }
                }
            }
        }

        public void Sent(string baseUtn, JobRequest request) =>
            Append(new Entry { Utn = baseUtn, State = "sent", Type = request.Type, AmountCents = request.AmountCents, At = DateTime.UtcNow.ToString("o") });

        public void Done(string baseUtn, JobRequest request, BridgeResult result) =>
            Append(new Entry { Utn = baseUtn, State = "done", Type = request.Type, AmountCents = request.AmountCents, At = DateTime.UtcNow.ToString("o"), Result = result });

        public Entry Find(string baseUtn)
        {
            lock (sync) return latest.TryGetValue(baseUtn, out var entry) ? entry : null;
        }

        /// <summary>Payments sent to the terminal whose answer never arrived (bridge crashed).</summary>
        public List<Entry> InFlight()
        {
            lock (sync)
            {
                var list = new List<Entry>();
                foreach (var entry in latest.Values) if (entry.State == "sent") list.Add(entry);
                return list;
            }
        }

        void Append(Entry entry)
        {
            lock (sync)
            {
                Rotate();
                var line = JsonSerializer.Serialize(entry, Json.Options) + Environment.NewLine;
                using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (var writer = new StreamWriter(stream))
                {
                    writer.Write(line);
                    writer.Flush();
                    stream.Flush(true);
                }
                latest[entry.Utn] = entry;
            }
        }

        void Rotate()
        {
            if (!File.Exists(path) || new FileInfo(path).Length < RotateBytes) return;
            var oldest = path + "." + KeepFiles;
            if (File.Exists(oldest)) File.Delete(oldest);
            for (var i = KeepFiles - 1; i >= 1; i--)
            {
                var source = path + "." + i;
                if (File.Exists(source)) File.Move(source, path + "." + (i + 1));
            }
            File.Move(path, path + ".1");
        }
    }

    public static class Json
    {
        public static readonly JsonSerializerOptions Options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            PropertyNameCaseInsensitive = true,
        };
    }

    /// <summary>Newline-delimited JSON log with size rotation. Never logs card numbers.</summary>
    public class Log
    {
        const long RotateBytes = 5L * 1024 * 1024;
        const int KeepFiles = 5;
        readonly string path;
        readonly object sync = new object();
        public bool Echo { get; set; } = true;

        public Log(string directory)
        {
            Directory.CreateDirectory(directory);
            path = Path.Combine(directory, "bridge.log");
        }

        public void Info(string evt, object detail = null) => Write("info", evt, detail);
        public void Warn(string evt, object detail = null) => Write("warn", evt, detail);
        public void Error(string evt, object detail = null) => Write("error", evt, detail);

        void Write(string level, string evt, object detail)
        {
            var payload = detail == null ? "null" : JsonSerializer.Serialize(detail, Json.Options);
            var line = "{\"timestamp\":\"" + DateTime.UtcNow.ToString("o") + "\",\"level\":\"" + level + "\",\"event\":\"" + evt + "\",\"detail\":" + Formatting.Redact(payload) + "}";
            lock (sync)
            {
                try
                {
                    if (File.Exists(path) && new FileInfo(path).Length >= RotateBytes)
                    {
                        var oldest = path + "." + KeepFiles;
                        if (File.Exists(oldest)) File.Delete(oldest);
                        for (var i = KeepFiles - 1; i >= 1; i--)
                        {
                            var source = path + "." + i;
                            if (File.Exists(source)) File.Move(source, path + "." + (i + 1));
                        }
                        File.Move(path, path + ".1");
                    }
                    File.AppendAllText(path, line + Environment.NewLine);
                }
                catch (IOException)
                {
                    // Logging must never break a payment.
                }
                if (Echo) Console.WriteLine(line);
            }
        }
    }
}
