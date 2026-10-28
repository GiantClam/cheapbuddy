# DeepSeek routing scripts

Use [the routing runbook](configure-deepseek-routing.md) for public ID `deepseek-flash` (DeepSeek Flash), the selectable canonical 1017 model, compatibility aliases, suppliers 8/12, exclusions 3/2, permissions, cost settings and commands. It is the single source for this procedure.

| Script | Behavior |
| --- | --- |
| [setup-deepseek-routing.ps1](setup-deepseek-routing.ps1) | Read-only configuration audit using actual relay aliases |
| [verify-deepseek-routing.ps1](verify-deepseek-routing.ps1) | One minimal billed request; requires nonempty response content |

Both scripts use PowerShell 7 and credentials supplied through protected environment variables. They do not change configuration. A passing configuration audit does not prove provider availability.
