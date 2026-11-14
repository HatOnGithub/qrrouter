using System.Text.Json;

namespace QrRouterApi.Middlewares;

/// <summary>
/// Translate expected failures to JSON; unexpected details stay in logs. A failed response
/// must not imply that native stock rolled back, because native writes use another database.
/// </summary>
public sealed class ErrorHandlerMiddleware(
    RequestDelegate next,
    ILogger<ErrorHandlerMiddleware> logger
)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception e)
        {
            var status = e switch
            {
                UnauthorizedAccessException => 403,
                KeyNotFoundException => 404,
                InvalidOperationException => 409,
                ArgumentException or JsonException or FormatException or OverflowException => 400,
                _ => 500,
            };
            if (status == 500)
                logger.LogError(e, "QR Router request failed");
            context.Response.StatusCode = status;
            await context.Response.WriteAsJsonAsync(
                new
                {
                    message = status == 500
                        ? "Inventory service failed; pending operations are retained. Check service logs."
                        : e.Message,
                }
            );
        }
    }
}
