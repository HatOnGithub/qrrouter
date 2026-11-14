namespace QrRouterApi.DTO;

/// <summary>
/// Server-supplied Dolibarr context, not a browser credential. Use/Read gate module access;
/// Permissions contains independent grants. Manage is not a blanket write grant. Stock
/// and History represent additional native-aware checks performed by the adapter.
/// </summary>
public sealed record Actor(
    int EntityId,
    int UserId,
    bool Read,
    bool Manage,
    bool Stock,
    bool Admin,
    bool History = false,
    bool Use = false,
    string[]? Permissions = null
);
