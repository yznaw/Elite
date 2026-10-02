using System;
using System.Collections.Generic;

namespace EliteCardBridge
{
    /// <summary>
    /// One physical (or simulated) EFT terminal. Calls block until the
    /// terminal finishes, exactly like the QNB DLL, and are only ever made
    /// from the single JobRunner worker thread.
    /// </summary>
    public interface ITerminal
    {
        string Mode { get; }
        string DllVersion { get; }
        string Port { get; }
        bool Connected { get; }

        /// <summary>Opens the link. Returns a DLL error code (0 = OK).</summary>
        int Connect();

        /// <summary>Runs one operation. <paramref name="utn"/> is the exact
        /// string sent to the DLL (retry digit included).</summary>
        TerminalResponse Execute(JobRequest request, string utn, Action<TerminalMessage> onMessage, Action<string> onReceipt);

        /// <summary>TransactionStatus(utn): 24 approved, 26 will reverse, 9 not found.</summary>
        int Status(string utn);

        void Reconfigure(string port);
        IList<string> AvailablePorts();
    }

    /// <summary>Turns a raw terminal response into the POS-facing result.</summary>
    public static class ResultMapper
    {
        public static BridgeResult Map(JobRequest request, TerminalResponse response, string receiptText)
        {
            if (response.Exception != null)
            {
                return new BridgeResult
                {
                    Outcome = JobTypes.Financial.Contains(request.Type) ? Outcomes.Unknown : Outcomes.Error,
                    Code = "BRIDGE_EXCEPTION",
                    Message = "The card machine stopped answering. Checking what happened is required before trying again.",
                    TerminalErrorCode = -1,
                };
            }

            var (code, outcome, message) = ErrorMap.For(request.Type, response.ErrorCode);
            var tags = response.Tags ?? new TerminalTags();
            var hostMessage = outcome == Outcomes.Declined ? ErrorMap.HostMessage(tags.HostResponseCode) : null;
            var result = new BridgeResult
            {
                Outcome = outcome,
                Code = code,
                Message = hostMessage ?? message,
                TerminalErrorCode = response.ErrorCode,
                HostResponseCode = Clean(tags.HostResponseCode, 10),
                AuthCode = Clean(tags.AuthCode, 12),
                MaskedPan = Formatting.MaskedPan(tags.Pan),
                CardExpiry = Formatting.Expiry(tags.Expiry),
                Issuer = Clean(tags.Issuer, 40),
                Tid = Clean(tags.Tid, 20),
                Mid = Clean(tags.Mid, 20),
                SeqNo = Clean(tags.SeqNo, 20),
                InvoiceNo = Clean(tags.InvoiceNo, 20),
                HostTrace = Clean(tags.HostTrace, 20),
                TxnAt = Formatting.TxnAt(tags.Date, tags.Time),
                EntryMethod = Clean(tags.EntryMethod, 20),
                PinVerified = Bool(tags.PinVerified),
                ReceiptText = Formatting.ContainsPan(receiptText) ? null : receiptText,
            };

            // An approval without an auth code cannot be matched to the bank
            // statement or refunded later: treat it as unknown, not approved.
            if (outcome == Outcomes.Approved && request.Type == JobTypes.Sale && string.IsNullOrEmpty(result.AuthCode))
            {
                result.Outcome = Outcomes.Unknown;
                result.Code = "APPROVED_WITHOUT_AUTH_CODE";
                result.Message = "The card machine answered without an approval code. Checking is required.";
            }

            if (!JobTypes.Financial.Contains(request.Type))
            {
                result.Info = new Dictionary<string, string>();
                Add(result.Info, "terminalModel", tags.TerminalModel);
                Add(result.Info, "terminalSerial", tags.TerminalSerial);
                Add(result.Info, "appVersion", tags.AppVersion);
                Add(result.Info, "loggedOn", tags.LoggedOn);
                Add(result.Info, "batchEmpty", tags.BatchEmpty);
                Add(result.Info, "tid", tags.Tid);
                Add(result.Info, "mid", tags.Mid);
            }
            return result;
        }

        public static StatusAnswer FromStatus(string utn, int code)
        {
            switch (code)
            {
                case ErrorMap.ERROR_TXN_APPROVED: return new StatusAnswer { Utn = utn, Status = "approved", Source = "terminal" };
                case ErrorMap.ERROR_TXN_WILL_REVERSED: return new StatusAnswer { Utn = utn, Status = "reversed", Source = "terminal" };
                case ErrorMap.ERROR_TNF: return new StatusAnswer { Utn = utn, Status = "not_found", Source = "terminal" };
                case ErrorMap.ERROR_TXN_DECLINE: return new StatusAnswer { Utn = utn, Status = "declined", Source = "terminal" };
                default: return new StatusAnswer { Utn = utn, Status = "unknown", Source = "terminal" };
            }
        }

        static void Add(Dictionary<string, string> info, string key, string value)
        {
            var clean = Clean(value, 60);
            if (clean != null) info[key] = clean;
        }

        static string Clean(string value, int max)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var text = value.Trim();
            if (text.Length > max) text = text.Substring(0, max);
            return Formatting.ContainsPan(text) ? null : text;
        }

        static bool? Bool(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var v = value.Trim().ToLowerInvariant();
            if (v == "true" || v == "1" || v == "y" || v == "yes") return true;
            if (v == "false" || v == "0" || v == "n" || v == "no") return false;
            return null;
        }
    }
}
