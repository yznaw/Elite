using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace EliteCardBridge
{
    public class BridgeError : Exception
    {
        public int Status { get; }
        public string Code { get; }
        public BridgeError(int status, string code, string message) : base(message) { Status = status; Code = code; }
    }

    /// <summary>
    /// Runs terminal operations one at a time (the terminal can only do one
    /// thing). The POS starts a job and polls it; the job carries the latest
    /// terminal screen text and, at the end, the result.
    /// </summary>
    public class JobRunner
    {
        const int KeepJobs = 100;
        readonly ITerminal terminal;
        readonly Journal journal;
        readonly Log log;
        readonly object sync = new object();
        readonly Dictionary<string, Job> jobs = new Dictionary<string, Job>(StringComparer.Ordinal);
        readonly LinkedList<string> order = new LinkedList<string>();
        Job active;

        public JobRunner(ITerminal terminal, Journal journal, Log log)
        {
            this.terminal = terminal;
            this.journal = journal;
            this.log = log;
        }

        public bool Busy { get { lock (sync) return active != null; } }

        public Job Get(string id)
        {
            lock (sync) return jobs.TryGetValue(id ?? "", out var job) ? job : null;
        }

        public static void Validate(JobRequest request)
        {
            if (request == null || !JobTypes.All.Contains(request.Type ?? "")) throw new BridgeError(422, "JOB_TYPE_INVALID", "Unknown terminal operation.");
            if (!JobTypes.Financial.Contains(request.Type)) return;
            if (!Formatting.IsUtn(request.Utn)) throw new BridgeError(422, "UTN_INVALID", "utn must be 8-22 capital letters or digits ending in a digit.");
            if (request.AmountCents <= 0 || request.AmountCents > Formatting.MaxAmountCents) throw new BridgeError(422, "AMOUNT_INVALID", "amountCents is out of range.");
            if (request.Email != null && (request.Email.Length > 120 || !request.Email.Contains("@"))) throw new BridgeError(422, "EMAIL_INVALID", "email is invalid.");
            if (request.Type == JobTypes.Void && !Formatting.IsUtn(request.OriginalUtn))
            {
                throw new BridgeError(422, "ORIGINAL_UTN_INVALID", "A void needs originalUtn, the UTN of the sale being voided.");
            }
            if (request.Type == JobTypes.Refund)
            {
                var o = request.Original;
                if (o == null) throw new BridgeError(422, "ORIGINAL_REQUIRED", "A refund needs the original sale details.");
                try { Formatting.SeqNo(o.SeqNo); } catch (ArgumentException) { throw new BridgeError(422, "ORIGINAL_INVALID", "original.seqNo must be 1-10 digits."); }
                if (!Formatting.IsDdMmYy(o.Date)) throw new BridgeError(422, "ORIGINAL_INVALID", "original.date must be DDMMYY.");
                if (string.IsNullOrWhiteSpace(o.AuthCode) || o.AuthCode.Trim().Length > 6) throw new BridgeError(422, "ORIGINAL_INVALID", "original.authCode must be 1-6 characters.");
                if (o.AmountCents < request.AmountCents) throw new BridgeError(422, "ORIGINAL_INVALID", "original.amountCents must cover the refund amount.");
            }
            if (request.Type == JobTypes.ReprintInvoice && (string.IsNullOrEmpty(request.InvoiceNumber) || request.InvoiceNumber.Length > 6))
            {
                throw new BridgeError(422, "INVOICE_INVALID", "invoiceNumber must be 1-6 digits.");
            }
        }

        public Job Submit(JobRequest request)
        {
            Validate(request);
            if (request.Type == JobTypes.ReprintInvoice && !request.InvoiceNumber.All(char.IsDigit)) throw new BridgeError(422, "INVOICE_INVALID", "invoiceNumber must be digits.");
            var financial = JobTypes.Financial.Contains(request.Type);
            Job job;
            lock (sync)
            {
                if (financial)
                {
                    var baseUtn = Formatting.BaseUtn(request.Utn);
                    var known = journal.Find(baseUtn);
                    if (known != null && known.State == "done")
                    {
                        // Same UTN again (POS retried after a network blip):
                        // answer from the journal. Never charge twice.
                        if (known.Type != request.Type || known.AmountCents != request.AmountCents)
                        {
                            throw new BridgeError(409, "UTN_CONFLICT", "This UTN was already used for a different operation.");
                        }
                        return Remember(new Job
                        {
                            Id = Guid.NewGuid().ToString("N"), Request = request, State = "done", Result = known.Result,
                            CreatedAt = DateTime.UtcNow, FinishedAt = DateTime.UtcNow,
                        });
                    }
                    if (known != null && known.State == "sent" && (active == null || active.Request.Utn == null || Formatting.BaseUtn(active.Request.Utn) != baseUtn))
                    {
                        throw new BridgeError(409, "UTN_IN_FLIGHT", "This payment was sent to the card machine and its result is not known yet. Check its status first.");
                    }
                }
                if (active != null) throw new BridgeError(409, "TERMINAL_BUSY", "The card machine is busy with another operation.");
                job = Remember(new Job { Id = Guid.NewGuid().ToString("N"), Request = request, State = "running", CreatedAt = DateTime.UtcNow });
                active = job;
            }
            Task.Run(() => Run(job));
            return job;
        }

        Job Remember(Job job)
        {
            jobs[job.Id] = job;
            order.AddLast(job.Id);
            while (order.Count > KeepJobs)
            {
                jobs.Remove(order.First.Value);
                order.RemoveFirst();
            }
            return job;
        }

        void Run(Job job)
        {
            var request = job.Request;
            var financial = JobTypes.Financial.Contains(request.Type);
            var receipt = new StringBuilder();
            BridgeResult result;
            try
            {
                if (!terminal.Connected && terminal.Connect() != ErrorMap.OK)
                {
                    result = new BridgeResult
                    {
                        Outcome = Outcomes.Error, Code = "TERMINAL_NOT_CONNECTED", TerminalErrorCode = ErrorMap.ERROR_PORT_CONNECTION,
                        Message = "The card machine is not connected. Check the cable and that it is on its base. Nothing was charged.",
                    };
                }
                else
                {
                    var utn = request.Utn;
                    if (financial) journal.Sent(Formatting.BaseUtn(utn), request);
                    var response = Execute(job, request, utn, receipt);
                    if (financial && response.Exception == null && response.ErrorCode == ErrorMap.ERROR_TNL)
                    {
                        // Guide Appendix C "Reactive Logon": log on, then resend
                        // the same payment with the retry digit bumped.
                        log.Info("reactive_logon", new { type = request.Type });
                        var logon = terminal.Execute(new JobRequest { Type = JobTypes.Logon }, null, m => SetMessage(job, m), _ => { });
                        if (logon.Exception == null && logon.ErrorCode == ErrorMap.OK)
                        {
                            receipt.Clear();
                            response = Execute(job, request, Formatting.NextRetry(utn), receipt);
                        }
                    }
                    result = ResultMapper.Map(request, response, receipt.Length > 0 ? receipt.ToString() : null);
                    if (response.Exception != null) log.Error("terminal_exception", new { type = request.Type, error = response.Exception });
                }
            }
            catch (Exception error)
            {
                log.Error("job_failed", new { type = request.Type, error = error.Message });
                result = new BridgeResult
                {
                    Outcome = financial ? Outcomes.Unknown : Outcomes.Error, Code = "BRIDGE_EXCEPTION", TerminalErrorCode = -1,
                    Message = "The card bridge hit an error. Check the payment status before trying again.",
                };
            }

            if (financial) journal.Done(Formatting.BaseUtn(request.Utn), request, result);
            log.Info("job_done", new
            {
                type = request.Type, utn = request.Utn, amountCents = request.AmountCents, outcome = result.Outcome,
                code = result.Code, terminalErrorCode = result.TerminalErrorCode, hostResponseCode = result.HostResponseCode,
            });
            lock (sync)
            {
                job.Result = result;
                job.State = "done";
                job.FinishedAt = DateTime.UtcNow;
                active = null;
            }
        }

        TerminalResponse Execute(Job job, JobRequest request, string utn, StringBuilder receipt)
        {
            try
            {
                return terminal.Execute(request, utn, m => SetMessage(job, m), text => { lock (receipt) receipt.Append(text); });
            }
            catch (Exception error)
            {
                return new TerminalResponse { ErrorCode = -1, Exception = error.GetType().Name + ": " + error.Message };
            }
        }

        void SetMessage(Job job, TerminalMessage message)
        {
            lock (sync) job.Message = message;
        }

        /// <summary>
        /// What happened to a payment: journal first (instant, no terminal
        /// call), otherwise ask the terminal with TransactionStatus.
        /// </summary>
        public StatusAnswer Status(string utn)
        {
            if (!Formatting.IsUtn(utn)) throw new BridgeError(422, "UTN_INVALID", "utn is invalid.");
            var baseUtn = Formatting.BaseUtn(utn);
            lock (sync)
            {
                if (active?.Request.Utn != null && Formatting.BaseUtn(active.Request.Utn) == baseUtn)
                {
                    return new StatusAnswer { Utn = utn, Status = "in_progress", Source = "bridge" };
                }
            }
            var known = journal.Find(baseUtn);
            if (known?.State == "done" && known.Result != null && known.Result.Outcome != Outcomes.Unknown)
            {
                var status = known.Result.Outcome == Outcomes.Approved ? "approved"
                    : known.Result.Outcome == Outcomes.Error ? "not_found"
                    : "declined";
                return new StatusAnswer { Utn = utn, Status = status, Source = "journal", Result = known.Result };
            }

            lock (sync)
            {
                if (active != null) throw new BridgeError(409, "TERMINAL_BUSY", "The card machine is busy; check again in a moment.");
                active = new Job { Id = "status", Request = new JobRequest { Type = "status", Utn = utn }, State = "running", CreatedAt = DateTime.UtcNow };
            }
            try
            {
                if (!terminal.Connected && terminal.Connect() != ErrorMap.OK)
                {
                    return new StatusAnswer { Utn = utn, Status = "unknown", Source = "bridge" };
                }
                var answer = ResultMapper.FromStatus(utn, terminal.Status(utn));
                // The journal's result (with auth code, card, receipt) is kept
                // when the terminal confirms the approval.
                if (answer.Status == "approved" && known?.Result?.AuthCode != null) answer.Result = known.Result;
                log.Info("status_checked", new { utn, status = answer.Status, journal = known?.State });
                return answer;
            }
            catch (Exception error)
            {
                log.Error("status_failed", new { utn, error = error.Message });
                return new StatusAnswer { Utn = utn, Status = "unknown", Source = "bridge" };
            }
            finally
            {
                lock (sync) active = null;
            }
        }
    }
}
