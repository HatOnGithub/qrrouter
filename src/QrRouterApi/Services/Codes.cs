using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace QrRouterApi.Services;

public static partial class Codes
{
    public const string Alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    public static char Check(string payload)
    {
        if (payload.Length != 5 || payload.Any(c => !Alphabet.Contains(c)))
            throw new ArgumentException("Invalid short QR payload");
        var state = 0;
        foreach (var c in payload)
            state = (state * 3 + Alphabet.IndexOf(c) + 1) % 31;
        return Alphabet[state];
    }

    public static bool Valid(string code) =>
        code.Length == 6
            ? code.Take(5).All(Alphabet.Contains) && Check(code[..5]) == code[5]
            : Legacy().IsMatch(code);

    public static string New()
    {
        var payload = string.Concat(
            Enumerable.Range(0, 5).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(31)])
        );
        return payload + Check(payload);
    }

    [GeneratedRegex(@"\A(?:[A-HJ-NP-Z2-9]{10}|(?:ITM|GEN|BOX|QR)-[A-Z0-9_-]{6,48})\z")]
    private static partial Regex Legacy();
}
