using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using QrRouterApi.Helpers;

namespace QrRouterApi.Middlewares;

public sealed class ApiKeyMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IOptions<AppSettings> options)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        if (context.Request.Path == "/health")
        {
            await next(context);
            return;
        }
        var actual = SHA256.HashData(
            Encoding.UTF8.GetBytes(context.Request.Headers["X-Api-Key"].ToString())
        );
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(options.Value.ApiKey));
        if (!CryptographicOperations.FixedTimeEquals(actual, expected))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { message = "Unauthorized client" });
            return;
        }
        await next(context);
    }
}
