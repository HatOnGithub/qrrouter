namespace QrRouterApi.DTO;

// The API key authenticates the trusted Dolibarr adapter. Browsers never receive it.
public sealed record Actor(
    int EntityId,
    int UserId,
    bool Read,
    bool Manage,
    bool Stock,
    bool Admin
);
