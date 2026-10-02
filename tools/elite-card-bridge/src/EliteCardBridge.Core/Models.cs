using System;
using System.Collections.Generic;

namespace EliteCardBridge
{
    /// <summary>Operations the POS can ask the terminal to run.</summary>
    public static class JobTypes
    {
        public const string Sale = "sale";
        public const string Void = "void";
        public const string Refund = "refund";
        public const string Logon = "logon";
        public const string Logoff = "logoff";
        public const string CloseBatch = "closeBatch";
        public const string Summary = "summary";
        public const string Audit = "audit";
        public const string ReprintLast = "reprintLast";
        public const string ReprintInvoice = "reprintInvoice";
        public const string Initialize = "initialize";
        public const string Restart = "restart";
        public const string Settings = "settings";

        /// <summary>Money moves: these carry a UTN, are journaled, and an
        /// unclear end is "unknown", never "declined".</summary>
        public static readonly HashSet<string> Financial = new HashSet<string> { Sale, Void, Refund };

        public static readonly HashSet<string> All = new HashSet<string>
        {
            Sale, Void, Refund, Logon, Logoff, CloseBatch, Summary, Audit,
            ReprintLast, ReprintInvoice, Initialize, Restart, Settings,
        };
    }

    public static class Outcomes
    {
        public const string Approved = "approved";
        public const string Declined = "declined";
        public const string Cancelled = "cancelled";
        /// <summary>The terminal may or may not have charged; resolve with a status check.</summary>
        public const string Unknown = "unknown";
        /// <summary>The bridge refused before talking to the terminal; nothing was charged.</summary>
        public const string Error = "error";
        /// <summary>Admin operation finished.</summary>
        public const string Ok = "ok";
    }

    public class OriginalTransaction
    {
        /// <summary>Sequence number of the original sale (TAG_TXN_SEQ_NO).</summary>
        public string SeqNo { get; set; }
        /// <summary>Original date as DDMMYY.</summary>
        public string Date { get; set; }
        public string AuthCode { get; set; }
        public long AmountCents { get; set; }
    }

    public class JobRequest
    {
        public string Type { get; set; }
        public string Utn { get; set; }
        public long AmountCents { get; set; }
        /// <summary>Optional: DLL 5.0.0.11+ emails a digital receipt (needs QNB to enable it).</summary>
        public string Email { get; set; }
        public OriginalTransaction Original { get; set; }
        /// <summary>Void only: UTN of the sale being voided (the DLL's
        /// VoidTransaction takes the original UTN). The job's own Utn keys
        /// the journal and the Elite record.</summary>
        public string OriginalUtn { get; set; }
        public string InvoiceNumber { get; set; }
    }

    /// <summary>
    /// The only tag fields that ever leave the terminal adapter. Anything the
    /// DLL returns that is not listed here (ICC cryptograms, DCC internals,
    /// supervisor password…) is dropped at the source.
    /// </summary>
    public class TerminalTags
    {
        public string Result { get; set; }
        public string HostResponseCode { get; set; }
        public string HostText { get; set; }
        public string AuthCode { get; set; }
        public string Pan { get; set; }
        public string Expiry { get; set; }
        public string Issuer { get; set; }
        public string Tid { get; set; }
        public string Mid { get; set; }
        public string Date { get; set; }
        public string Time { get; set; }
        public string SeqNo { get; set; }
        public string InvoiceNo { get; set; }
        public string HostTrace { get; set; }
        public string EntryMethod { get; set; }
        public string PinVerified { get; set; }
        public string EchoUtn { get; set; }
        public string Amount { get; set; }
        public string BatchEmpty { get; set; }
        public string LoggedOn { get; set; }
        public string TerminalModel { get; set; }
        public string TerminalSerial { get; set; }
        public string AppVersion { get; set; }
    }

    /// <summary>What the terminal adapter returns for one operation.</summary>
    public class TerminalResponse
    {
        public int ErrorCode { get; set; }
        public TerminalTags Tags { get; set; }
        /// <summary>Set when the DLL threw: the outcome is unknown.</summary>
        public string Exception { get; set; }
    }

    public class TerminalMessage
    {
        public string Code { get; set; }
        public string Title { get; set; }
        public string[] Lines { get; set; }
        public DateTime At { get; set; }
    }

    /// <summary>Result sent to the POS. Never contains a full card number.</summary>
    public class BridgeResult
    {
        public string Outcome { get; set; }
        public string Code { get; set; }
        public string Message { get; set; }
        public int TerminalErrorCode { get; set; }
        public string HostResponseCode { get; set; }
        public string AuthCode { get; set; }
        public string MaskedPan { get; set; }
        public string CardExpiry { get; set; }
        public string Issuer { get; set; }
        public string Tid { get; set; }
        public string Mid { get; set; }
        public string SeqNo { get; set; }
        public string InvoiceNo { get; set; }
        public string HostTrace { get; set; }
        public string TxnAt { get; set; }
        public string EntryMethod { get; set; }
        public bool? PinVerified { get; set; }
        public string ReceiptText { get; set; }
        public Dictionary<string, string> Info { get; set; }
    }

    public class Job
    {
        public string Id { get; set; }
        public JobRequest Request { get; set; }
        public string State { get; set; } = "queued";
        public TerminalMessage Message { get; set; }
        public BridgeResult Result { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? FinishedAt { get; set; }
    }

    public class StatusAnswer
    {
        public string Utn { get; set; }
        /// <summary>approved | declined | reversed | not_found | in_progress | unknown</summary>
        public string Status { get; set; }
        public string Source { get; set; }
        public BridgeResult Result { get; set; }
    }
}
