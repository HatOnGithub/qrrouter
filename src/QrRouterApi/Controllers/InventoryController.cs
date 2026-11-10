using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using QrRouterApi.DTO;
using QrRouterApi.Services;

namespace QrRouterApi.Controllers;

[ApiController]
[Route("api/inventory")]
public sealed class InventoryController(IInventoryService service) : ControllerBase
{
    private Actor Actor()
    {
        int Number(string name) =>
            int.TryParse(Request.Headers[name], out var n) && n > 0
                ? n
                : throw new ArgumentException($"Missing {name}");
        bool Flag(string name) => Request.Headers[name] == "1";
        return new Actor(
            Number("X-Qrr-Entity"),
            Number("X-Qrr-User"),
            Flag("X-Qrr-Read"),
            Flag("X-Qrr-Manage"),
            Flag("X-Qrr-Stock"),
            Flag("X-Qrr-Admin")
        );
    }

    [HttpGet]
    // The PHP adapter does not use private audit history. Load it only for explicit exports.
    public IActionResult Get([FromQuery] bool includeHistory = false) =>
        Ok(service.State(Actor(), includeHistory));

    [HttpPost("{command}")]
    public IActionResult Command(string command, [FromBody] JsonObject data) =>
        Ok(new { result = service.Execute(Actor(), command, data) });
}
