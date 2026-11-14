namespace QrRouterApi.Helpers;

public sealed class AppSettings
{
    public string ApiKey { get; set; } = "";
    public string DataDirectory { get; set; } = "";

    /// <summary>Keep live inventory outside replaceable application files.</summary>
    public bool HasPersistentDataDirectory()
    {
        if (!Path.IsPathFullyQualified(DataDirectory))
            return false;
        var data = Path.TrimEndingDirectorySeparator(Path.GetFullPath(DataDirectory));
        var application = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(AppContext.BaseDirectory)
        );
        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        return !data.Equals(application, comparison)
            && !data.StartsWith(application + Path.DirectorySeparatorChar, comparison);
    }
}
