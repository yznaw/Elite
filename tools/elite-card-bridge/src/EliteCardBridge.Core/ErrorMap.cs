using System.Collections.Generic;

namespace EliteCardBridge
{
    /// <summary>
    /// DLL error codes (guide v1.29 Appendix A, confirmed against the
    /// ErrorCode enum in Ideal.PointOfSale.Integration 5.0.0.13) and the
    /// outcome each one means for money.
    /// </summary>
    public static class ErrorMap
    {
        public const int OK = 0;
        public const int ERROR_INVALID_PARAMETER = 1;
        public const int ERROR_TTO = 2;
        public const int ERROR_TNL = 3;
        public const int ERROR_NPL = 4;
        public const int ERROR_DCL = 5;
        public const int ERROR_PORT_CONNECTION = 6;
        public const int ERROR_CTO = 7;
        public const int ERROR_SCP = 8;
        public const int ERROR_TNF = 9;
        public const int ERROR_RTC = 10;
        public const int ERROR_RTD = 11;
        public const int ERROR_NIF = 12;
        public const int ERROR_TXN_CANCELLED_BY_USER = 13;
        public const int ERROR_CARD_READ_FAIL = 14;
        public const int ERROR_NOBATCH_AVAILABLE = 15;
        public const int ERROR_TXN_NOT_ENABLE = 16;
        public const int ERROR_TIMEOUT_CARDENTRY = 17;
        public const int ERROR_TIMEOUT_PINENTRY = 18;
        public const int ERROR_TXN_DECLINE_BY_HOST = 19;
        public const int ERROR_TXN_DECLINE_BY_CARD = 20;
        public const int ERROR_TIMEOUT_DCCENTRY = 21;
        public const int ERROR_OUT_OF_PAPER = 22;
        public const int ERROR_TERMINAL_RESTARTED = 23;
        public const int ERROR_TXN_APPROVED = 24;
        public const int ERROR_TXN_DECLINE = 25;
        public const int ERROR_TXN_WILL_REVERSED = 26;
        public const int ERROR_TIME_TO_RESTART_TERMINAL = 27;
        public const int ERROR_DEFAULT = 30;
        public const int ERROR_DLL_TIME_OUT = 31;
        public const int ERROR_LOG_FILE_NOT_CREATED = 101;

        class Entry
        {
            public string Code;
            public string Outcome;
            public string Message;
            public Entry(string code, string outcome, string message) { Code = code; Outcome = outcome; Message = message; }
        }

        // Outcome for a financial operation. "error" = refused before the
        // terminal acted (nothing charged). "unknown" = the terminal may have
        // charged; only TransactionStatus can tell.
        static readonly Dictionary<int, Entry> Financial = new Dictionary<int, Entry>
        {
            [OK] = new Entry("APPROVED", Outcomes.Approved, "Approved."),
            [ERROR_INVALID_PARAMETER] = new Entry("INVALID_PARAMETER", Outcomes.Error, "The card machine rejected the request. Nothing was charged."),
            [ERROR_TTO] = new Entry("TRANSACTION_TIMEOUT", Outcomes.Declined, "Not completed on the card machine (timeout or declined). Nothing was charged."),
            [ERROR_TNL] = new Entry("NOT_LOGGED_ON", Outcomes.Declined, "The card machine is not logged on to the bank."),
            [ERROR_NPL] = new Entry("NO_HOST_CONNECTION", Outcomes.Declined, "The card machine could not reach the bank. Nothing was charged."),
            [ERROR_DCL] = new Entry("DECLINED", Outcomes.Declined, "Declined by the bank."),
            [ERROR_PORT_CONNECTION] = new Entry("PORT_CONNECTION", Outcomes.Unknown, "Lost the cable connection to the card machine."),
            [ERROR_CTO] = new Entry("CARD_TIMEOUT", Outcomes.Declined, "No card was presented in time."),
            [ERROR_SCP] = new Entry("SIGNATURE_CARD", Outcomes.Declined, "This card needs a signature, which is not supported."),
            [ERROR_TNF] = new Entry("TRANSACTION_NOT_FOUND", Outcomes.Declined, "The card machine could not find that transaction."),
            [ERROR_RTC] = new Entry("REVERSAL_CLEARED", Outcomes.Approved, "Reversed on the card machine."),
            [ERROR_RTD] = new Entry("REVERSAL_DECLINED", Outcomes.Declined, "The bank declined the reversal."),
            [ERROR_NIF] = new Entry("INVOICE_NOT_FOUND", Outcomes.Declined, "Invoice not found on the card machine."),
            [ERROR_TXN_CANCELLED_BY_USER] = new Entry("CANCELLED", Outcomes.Cancelled, "Cancelled on the card machine."),
            [ERROR_CARD_READ_FAIL] = new Entry("CARD_READ_FAILED", Outcomes.Declined, "The card could not be read. Try again or use another card."),
            [ERROR_NOBATCH_AVAILABLE] = new Entry("NO_BATCH", Outcomes.Declined, "There are no card transactions in the batch."),
            [ERROR_TXN_NOT_ENABLE] = new Entry("NOT_ENABLED", Outcomes.Declined, "This operation is not enabled on the card machine. Ask QNB."),
            [ERROR_TIMEOUT_CARDENTRY] = new Entry("CARD_TIMEOUT", Outcomes.Declined, "No card was presented in time."),
            [ERROR_TIMEOUT_PINENTRY] = new Entry("PIN_TIMEOUT", Outcomes.Declined, "The PIN was not entered in time."),
            [ERROR_TXN_DECLINE_BY_HOST] = new Entry("DECLINED", Outcomes.Declined, "Declined by the bank."),
            [ERROR_TXN_DECLINE_BY_CARD] = new Entry("DECLINED_BY_CARD", Outcomes.Declined, "Declined by the card."),
            [ERROR_TIMEOUT_DCCENTRY] = new Entry("DCC_TIMEOUT", Outcomes.Declined, "The currency choice was not made in time."),
            [ERROR_OUT_OF_PAPER] = new Entry("OUT_OF_PAPER", Outcomes.Declined, "The card machine is out of paper."),
            [ERROR_TERMINAL_RESTARTED] = new Entry("TERMINAL_RESTARTED", Outcomes.Unknown, "The card machine restarted during the payment."),
            [ERROR_TXN_APPROVED] = new Entry("APPROVED", Outcomes.Approved, "Approved."),
            [ERROR_TXN_DECLINE] = new Entry("DECLINED", Outcomes.Declined, "Declined."),
            [ERROR_TXN_WILL_REVERSED] = new Entry("WILL_REVERSE", Outcomes.Declined, "Not completed; the card machine will reverse it automatically."),
            [ERROR_TIME_TO_RESTART_TERMINAL] = new Entry("TERMINAL_RESTARTING", Outcomes.Unknown, "The card machine is restarting."),
            [ERROR_DEFAULT] = new Entry("TERMINAL_ERROR", Outcomes.Unknown, "The card machine returned an unexpected error."),
            [ERROR_DLL_TIME_OUT] = new Entry("DLL_TIMEOUT", Outcomes.Unknown, "No final answer from the card machine within 120 seconds."),
            [ERROR_LOG_FILE_NOT_CREATED] = new Entry("LOG_FILE_NOT_CREATED", Outcomes.Error, "The card bridge cannot write its log file. Nothing was charged; call support."),
        };

        /// <summary>Maps a DLL code for an operation type to (code, outcome, message).</summary>
        public static (string Code, string Outcome, string Message) For(string jobType, int errorCode)
        {
            var financial = JobTypes.Financial.Contains(jobType);
            if (!Financial.TryGetValue(errorCode, out var entry))
            {
                entry = new Entry("TERMINAL_ERROR_" + errorCode, Outcomes.Unknown, "The card machine returned error " + errorCode + ".");
            }
            if (financial) return (entry.Code, entry.Outcome, entry.Message);
            // Admin operations move no money: success is "ok", anything else an
            // error the cashier can retry. An empty batch is still a successful close.
            if (errorCode == OK || (jobType == JobTypes.CloseBatch && errorCode == ERROR_NOBATCH_AVAILABLE))
            {
                return (errorCode == OK ? "OK" : "NO_BATCH", Outcomes.Ok, errorCode == OK ? "Done." : "There were no card transactions to close.");
            }
            return (entry.Code, Outcomes.Error, entry.Message);
        }

        /// <summary>Plain-English text for common QNB host response codes (Appendix B).</summary>
        public static string HostMessage(string hostCode)
        {
            switch ((hostCode ?? "").Trim())
            {
                case "051": case "901": return "The card has expired.";
                case "052": case "900": return "Too many wrong PIN attempts.";
                case "055": case "201": return "Wrong PIN.";
                case "057": case "903": return "The card was reported lost or stolen.";
                case "076": case "094": case "116": return "Insufficient funds.";
                case "059": return "The card is restricted.";
                case "105": return "This card is not supported.";
                case "107": return "Over the card's daily limit.";
                case "113": case "810": return "The bank did not answer in time.";
                default: return null;
            }
        }
    }
}
