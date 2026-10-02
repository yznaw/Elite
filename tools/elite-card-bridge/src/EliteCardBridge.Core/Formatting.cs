using System;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace EliteCardBridge
{
    /// <summary>Conversions between Elite's values and the formats the QNB DLL expects.</summary>
    public static class Formatting
    {
        // Guide v1.29 §12.1.3: amount Nd 12, implied 2 decimals, at most 10 integer digits.
        public const long MaxAmountCents = 999_999_999_999;
        static readonly Regex UtnPattern = new Regex("^[A-Z0-9]{8,22}$", RegexOptions.Compiled);
        static readonly Regex DigitRun = new Regex("[0-9]{13,19}", RegexOptions.Compiled);

        /// <summary>Cents to the decimal string the DLL's Sale/Refund take ("50.00").</summary>
        public static string Amount(long cents)
        {
            if (cents <= 0 || cents > MaxAmountCents) throw new ArgumentOutOfRangeException(nameof(cents));
            return (cents / 100).ToString(CultureInfo.InvariantCulture) + "." + (cents % 100).ToString("00", CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// DLL 5.0.0.13: a refund's original amount must be 12-digit numeric
        /// with implied decimals ("000000055000" for 550.00).
        /// </summary>
        public static string Amount12(long cents)
        {
            if (cents <= 0 || cents > MaxAmountCents) throw new ArgumentOutOfRangeException(nameof(cents));
            return cents.ToString("000000000000", CultureInfo.InvariantCulture);
        }

        /// <summary>Original sequence number, left padded with zeros (guide v1.11).</summary>
        public static string SeqNo(string value)
        {
            var digits = (value ?? "").Trim();
            if (digits.Length == 0 || digits.Length > 10 || !IsDigits(digits)) throw new ArgumentException("Sequence number must be 1-10 digits.");
            return digits.PadLeft(10, '0');
        }

        public static bool IsDdMmYy(string value)
        {
            return value != null && value.Length == 6 && IsDigits(value)
                && DateTime.TryParseExact(value, "ddMMyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
        }

        /// <summary>
        /// The POS sends the UTN with its retry digit already on the right
        /// (the DLL treats the rightmost digit as a retry counter and strips
        /// it). Max 22 characters in total.
        /// </summary>
        public static bool IsUtn(string value) => value != null && UtnPattern.IsMatch(value) && char.IsDigit(value[value.Length - 1]);

        /// <summary>Same UTN with the retry digit bumped, for a resend after logon.</summary>
        public static string NextRetry(string utn)
        {
            var last = utn[utn.Length - 1] - '0';
            return utn.Substring(0, utn.Length - 1) + ((last + 1) % 10).ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>Retry digit removed: the identity of the payment.</summary>
        public static string BaseUtn(string utn) => utn.Substring(0, utn.Length - 1);

        /// <summary>
        /// NNNNNNXXXXXXNNNNFFFFF (or * as mask on older builds) to
        /// NNNNNNXXXXXXNNNN. Returns null for anything that is not a masked PAN,
        /// so an unmasked number can never be passed on.
        /// </summary>
        public static string MaskedPan(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var pan = raw.Trim().ToUpperInvariant().TrimEnd('F').Replace('*', 'X');
            return Regex.IsMatch(pan, "^[0-9]{6}X{2,9}[0-9]{4}$") ? pan : null;
        }

        public static string Expiry(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var value = raw.Trim();
            return value.Length == 4 && IsDigits(value) && value != "0000" ? value : null;
        }

        /// <summary>
        /// True if the text holds a plausible full card number (13-19 digits,
        /// also spaced or dashed, starting 2-6, passing Luhn). Used to refuse
        /// logging or returning such text. Same rule as the Elite server.
        /// </summary>
        public static bool ContainsPan(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            foreach (var candidate in new[] { text, Regex.Replace(text, "[ \\t-]", "") })
            {
                foreach (Match match in DigitRun.Matches(candidate))
                {
                    var run = match.Value;
                    if (run[0] >= '2' && run[0] <= '6' && Luhn(run)) return true;
                }
            }
            return false;
        }

        public static string Redact(string text)
        {
            if (string.IsNullOrEmpty(text) || !ContainsPan(text)) return text;
            return DigitRun.Replace(text, m => m.Value.Length > 10 ? m.Value.Substring(0, 6) + new string('X', m.Value.Length - 10) + m.Value.Substring(m.Value.Length - 4) : m.Value);
        }

        static bool Luhn(string digits)
        {
            var sum = 0;
            for (var i = 0; i < digits.Length; i++)
            {
                var d = digits[digits.Length - 1 - i] - '0';
                if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9; }
                sum += d;
            }
            return sum % 10 == 0;
        }

        static bool IsDigits(string value)
        {
            foreach (var c in value) if (c < '0' || c > '9') return false;
            return true;
        }

        /// <summary>
        /// Terminal date (DDMMYY or YYMMDD varies by build) and time (HHMMSS)
        /// to ISO-8601 in Qatar time (+03:00). Null when unparseable.
        /// </summary>
        public static string TxnAt(string date, string time)
        {
            if (string.IsNullOrWhiteSpace(date)) return null;
            var t = string.IsNullOrWhiteSpace(time) ? "000000" : time.Trim().Replace(":", "");
            foreach (var format in new[] { "ddMMyyHHmmss", "yyMMddHHmmss", "ddMMyyyyHHmmss", "yyyyMMddHHmmss" })
            {
                if (DateTime.TryParseExact(date.Trim().Replace("/", "").Replace("-", "") + t, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
                    && parsed.Year >= 2020 && parsed.Year <= 2099)
                {
                    return new DateTimeOffset(parsed, TimeSpan.FromHours(3)).ToString("yyyy-MM-ddTHH:mm:ssK", CultureInfo.InvariantCulture);
                }
            }
            return null;
        }

        /// <summary>Strips the optional 3-digit display code ("001 SWIPE/INSERT/TAP CARD").</summary>
        public static TerminalMessage Message(string title, string[] lines)
        {
            string code = null;
            var cleanTitle = (title ?? "").Trim();
            var match = Regex.Match(cleanTitle, "^([0-9]{3})\\s+(.*)$");
            if (match.Success) { code = match.Groups[1].Value; cleanTitle = match.Groups[2].Value; }
            var clean = new string[lines.Length];
            for (var i = 0; i < lines.Length; i++)
            {
                var line = (lines[i] ?? "").Trim();
                var m = Regex.Match(line, "^([0-9]{3})\\s+(.*)$");
                if (m.Success) { code = code ?? m.Groups[1].Value; line = m.Groups[2].Value; }
                clean[i] = Redact(line);
            }
            return new TerminalMessage { Code = code, Title = Redact(cleanTitle), Lines = clean, At = DateTime.UtcNow };
        }
    }
}
