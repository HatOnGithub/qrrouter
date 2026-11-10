using QrRouterApi.Helpers;
using QrRouterApi.Middlewares;
using QrRouterApi.Repositories;
using QrRouterApi.Services;

// The runtime image needs no shell tools or extra packages for Docker health checks.
if (args is ["--healthcheck"])
{
    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        var response = await http.GetAsync("http://127.0.0.1:8080/health");
        return response.IsSuccessStatusCode ? 0 : 1;
    }
    catch (HttpRequestException)
    {
        return 1;
    }
    catch (TaskCanceledException)
    {
        return 1;
    }
}

var builder = WebApplication.CreateBuilder(args);
builder
    .Services.AddOptions<AppSettings>()
    .BindConfiguration("AppSettings")
    .Validate(s => s.ApiKey.Length >= 32, "Set AppSettings:ApiKey to at least 32 characters")
    .Validate(s => !string.IsNullOrWhiteSpace(s.DataDirectory), "Set a data directory")
    .ValidateOnStart();
builder.Services.AddControllers();
builder.Services.AddSingleton<IStateRepository, StateRepository>();
builder.Services.AddScoped<IInventoryService, InventoryService>();
var app = builder.Build();
app.UseMiddleware<ErrorHandlerMiddleware>();
app.UseMiddleware<ApiKeyMiddleware>();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapControllers();
app.Run();
return 0;
