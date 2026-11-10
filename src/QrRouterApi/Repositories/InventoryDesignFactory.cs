using Microsoft.EntityFrameworkCore.Design;

namespace QrRouterApi.Repositories;

// Schema scaffolding never needs an API key or a connection to production inventory.
// Database-update commands must explicitly supply a real connection via --connection.
public sealed class InventoryDesignFactory : IDesignTimeDbContextFactory<InventoryDbContext>
{
    public InventoryDbContext CreateDbContext(string[] args) =>
        new(InventoryDbContext.OptionsFor(":memory:"));
}
