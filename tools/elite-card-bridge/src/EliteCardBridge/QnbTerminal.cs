#if QNB_DLL
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using Ideal.PointOfSale.Integration;
using Ideal.PointOfSale.Integration.Models;

namespace EliteCardBridge
{
    /// <summary>
    /// The real QNB terminal through Ideal Solutions' high-level DLL
    /// (Ideal.PointOfSale.Integration 5.0.0.13, Technical Guide v1.29), over
    /// RS-232: N910 = 9600 baud, 7 data bits, even parity, 1 stop bit.
    /// Signatures checked against the delivered assembly's metadata.
    /// </summary>
    public sealed class QnbTerminal : ITerminal
    {
        readonly Log log;
        EcrPointOfSale ecr;
        Action<TerminalMessage> onMessage = _ => { };
        Action<string> onReceipt = _ => { };

        public QnbTerminal(string port, Log log)
        {
            this.log = log;
            Port = port;
            EnsureDllLogFolder();
            Create();
        }

        public string Mode => "real";
        public string DllVersion => typeof(EcrPointOfSale).Assembly.GetName().Version.ToString();
        public string Port { get; private set; }
        public bool Connected { get; private set; }

        /// <summary>
        /// DLL 5.0.0.12+ refuses every transaction (error 101) when it cannot
        /// write its log. log4net.config writes to "Logs\" under the working
        /// directory, so run from the install folder and make sure it exists.
        /// The installer grants the POS Windows account write access to it.
        /// </summary>
        static void EnsureDllLogFolder()
        {
            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDirectory);
            Directory.CreateDirectory(Path.Combine(baseDirectory, "Logs"));
        }

        void Create()
        {
            ecr = new EcrPointOfSale(Port, 9600, Parity.Even, 7, StopBits.One);
            ecr.OnIntermediateMessageReceived += (title, l1, l2, l3, l4) => onMessage(Formatting.Message(title, new[] { l1, l2, l3, l4 }));
            ecr.OnReceiptDataReceived += data => onReceipt(data);
        }

        public int Connect()
        {
            var result = ecr.Connect();
            Connected = result == ErrorMap.OK;
            return result;
        }

        public void Reconfigure(string port)
        {
            try { ecr?.Disconnect(); } catch (Exception error) { log.Warn("disconnect_failed", new { error = error.Message }); }
            Connected = false;
            Port = port;
            Create();
        }

        public IList<string> AvailablePorts() => SerialPort.GetPortNames();

        public int Status(string utn) => ecr.TransactionStatus(utn);

        public TerminalResponse Execute(JobRequest request, string utn, Action<TerminalMessage> message, Action<string> receipt)
        {
            onMessage = message ?? (_ => { });
            onReceipt = receipt ?? (_ => { });
            try
            {
                TagBuffer tags = null;
                int code;
                switch (request.Type)
                {
                    case JobTypes.Sale:
                        code = string.IsNullOrEmpty(request.Email)
                            ? ecr.Sale(Formatting.Amount(request.AmountCents), utn, out tags)
                            : ecr.Sale(Formatting.Amount(request.AmountCents), utn, request.Email, out tags);
                        break;
                    case JobTypes.Void:
                        code = ecr.VoidTransaction(request.OriginalUtn, out tags);
                        break;
                    case JobTypes.Refund:
                        // Always card-present (QCB NAPS mandate, owner decision):
                        // blank card number and expiry make the terminal ask for
                        // the card. Original amount in the same decimal form as
                        // the guide's EnhanceRefund example; the 5.0.0.13 DLL
                        // converts it to its 12-digit field.
                        var o = request.Original;
                        code = ecr.EnhanceRefund(
                            Formatting.Amount(request.AmountCents), Formatting.Amount(o.AmountCents),
                            Formatting.SeqNo(o.SeqNo), o.Date, o.AuthCode.Trim(), utn, "", "", out tags);
                        break;
                    case JobTypes.Logon: code = ecr.HostLogOn(); break;
                    case JobTypes.Logoff: code = ecr.HostLogOff(); break;
                    case JobTypes.CloseBatch: code = ecr.CloseBatch(out tags); break;
                    case JobTypes.Summary: code = ecr.SummaryReport(out tags); break;
                    case JobTypes.Audit: code = ecr.AuditReport(out tags); break;
                    case JobTypes.ReprintLast: code = ecr.ReceiptReprintLastTransaction(); break;
                    case JobTypes.ReprintInvoice: code = ecr.ReceiptReprintTransactionByInvoiceNumber(request.InvoiceNumber); break;
                    case JobTypes.Initialize: code = ecr.Initialize(out tags); break;
                    case JobTypes.Restart: code = ecr.Restart_Terminal(); break;
                    case JobTypes.Settings: code = ecr.ReturnTerminalSettings(out tags); break;
                    default: throw new ArgumentException("Unsupported operation " + request.Type);
                }
                if (code == ErrorMap.ERROR_PORT_CONNECTION) Connected = false;
                return new TerminalResponse { ErrorCode = code, Tags = Copy(tags) };
            }
            finally
            {
                onMessage = _ => { };
                onReceipt = _ => { };
            }
        }

        /// <summary>Whitelisted copy: ICC data, DCC internals and supervisor
        /// password never leave this method.</summary>
        static TerminalTags Copy(TagBuffer t)
        {
            if (t == null) return new TerminalTags();
            return new TerminalTags
            {
                Result = t.TAG_RESULT,
                HostResponseCode = t.TAG_HOST_RSP_CODE,
                HostText = t.TAG_HOST_TEXT,
                AuthCode = t.TAG_AUTHORIZATION_NO,
                Pan = t.TAG_PAN,
                Expiry = t.TAG_EXPIRATION_DATE,
                Issuer = t.TAG_ISSUER_NAME,
                Tid = string.IsNullOrWhiteSpace(t.TAG_TID) ? t.TAG_ACQUIRER_TID : t.TAG_TID,
                Mid = t.TAG_MERCHANT_ID,
                Date = t.TAG_DATE,
                Time = t.TAG_TIME,
                SeqNo = t.TAG_TXN_SEQ_NO,
                InvoiceNo = t.TAG_INVOICE_NUMBER,
                HostTrace = t.TAG_HOST_TRACE_NUMBER,
                EntryMethod = t.TAG_CARD_READING_METHOD,
                PinVerified = t.TAG_TRANSACTION_VERIFIED_BY_PIN,
                EchoUtn = t.TAG_ECR_UNIQUE_TXN_ID,
                Amount = t.TAG_AMOUNT,
                BatchEmpty = t.TAG_BATCH_EMPTY,
                LoggedOn = t.TAG_LOGGED_ON_STATUS,
                TerminalModel = t.TAG_POS_TERMINAL_MODEL,
                TerminalSerial = t.TAG_TERMINAL_SERIAL_NUMBER,
                AppVersion = t.TAG_POS_APPLICATION_VERSION,
            };
        }
    }
}
#endif
