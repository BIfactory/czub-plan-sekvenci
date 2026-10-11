# CLAUDE.md – backend

> Platí navíc ke kořenovému `CLAUDE.md` (ten se načítá automaticky). Sem patří jen to,
> co je specifické pro backend a neopakuje se jinde.

## Stack a struktura projektu

- .NET 8 (`net8.0-windows` – kvůli `System.DirectoryServices.AccountManagement`
  v `ApproverService`), ASP.NET Core Web API s kontrolery (ne minimal API).
- EF Core 8 + `Microsoft.Data.SqlClient` nad existující DB `BI_APP`, **bez migrací**
  (appka databázi nevlastní, viz PRD 4.1) – `DbContext.OnModelCreating` jen mapuje
  existující tabulky/views (`.ToTable()` / `.ToView()` + `.HasNoKey()` pro views).
- Struktura: `Controllers/` (tenké, jen mapování HTTP <-> service), `Services/`
  (business logika, filtrování/řazení/transakce), `Data/Entities/` (EF modely 1:1 na
  DB objekty), `Dtos/` (API kontrakty), `Authorization/` (approver policy).
- Fáze 1 pokrývá `WorkplanController`, `ProducedController`, `ReferenceController`,
  `AuthController` (viz PRD sekce 5–7).
- Fáze 2 (PRD sekce 2, 5.5) je hotová: kapacitní panely ("Aktuální data"/"Historie"/
  "Kapacita" na Plán sekvencí, "Vyhodnocení plánu"/"Graf vyhodnocení"/"Historie"/druhý
  grid na Vyhodnocení – viz `Data/Entities/NodeDataView.cs`, `ProducedTodayView.cs`,
  `NodeCapToday.cs`, `RgidCapToday.cs`, `NodeCapActual.cs`, `SaLastValid.cs`,
  `SaRgidLastValid.cs`) i podgalerie z gridu "Plán sekvencí": Detail operace
  (`v_sequences_detail` → `SequencesDetail.cs`, `GetSequenceDetailAsync`), Sériová
  čísla (`t_serial_numbers` → `SerialNumber.cs`, `GetSerialNumbersAsync`), Divergence
  (`t_divergence_all` → `DivergenceAll.cs`, `GetDivergenceAsync`) a X-suffix
  (`v_x_suffix` → `XSuffix.cs`, `GetXSuffixAsync`) – vše ve `WorkplanService.cs` /
  `WorkplanController.cs`. `WorkplanInputView`/`WorkplanItemDto` navíc nesou `Status`,
  `WorkflowLink`, `DivStatus` (z LEFT JOIN `t_divergence_oper` uvnitř `v_workplan_input`)
  pro tlačítko "Status" v gridu.
- Fáze 3 (kromě tiskového režimu, který zůstává nespecifikovaný – zadání se teprve
  doladí) je hotová:
  - **Automatický background refresh** – řeší frontend pollingem (`useAutoRefresh`),
    backend nepřidává nic navíc (žádný SignalR hub, viz frontend/CLAUDE.md). Interval
    (v sekundách) i platnost cookie s filtry (ve dnech) jsou konfigurovatelné v
    `appsettings.json` (sekce `ClientSettings` – `ClientSettingsOptions.cs`), appka je
    frontendu vystavuje přes `GET /api/config` (`ConfigController.cs`), protože
    postavený SPA build `appsettings.json` sám o sobě nečte – takhle jde hodnoty měnit
    bez rebuildu frontendu.
  - **Silnější validace** (PRD 4.5) – `SubmitReasonRequest.Reason`/`Note` mají
    `[MaxLength]` odpovídající nejtěsnějšímu sloupci, do kterého se zapisuje
    (`t_workplan_reasons.reason` nvarchar(100), `*.note`/`reason_note` nvarchar(600));
    `[ApiController]` díky tomu vrací 400 automaticky. `WorkplanService`/
    `ProducedService.SubmitReasonAsync` navíc ověřují, že `Reason` (pokud není prázdný)
    existuje v `dim_workplan_reasons` – jinak `ReasonSubmitResult.InvalidReason` → 400.
    Validace existence `id_job_suffix_oper`/`id` před zápisem už byla hotová dřív
    (`FirstOrDefaultAsync` → `NotFound`).
  - **Audit log editací** – nová tabulka `t_workplan_audit_log` (appka ji vlastní, ale
    kvůli PRD 4.1 ji nevytváří sama – DDL skript je v `backend/sql/t_workplan_audit_log.sql`,
    **je potřeba ho spustit v `BI_APP` ručně/přes DBA před nasazením této verze**).
    Zápis provádí `AuditLogService.Log(...)` (jen přidá do change trackeru, neukládá) –
    volá se z `WorkplanService.SetFixedAsync/SetSelectedAsync/SubmitReasonAsync` a
    `ProducedService.SubmitReasonAsync`, vždy ve stejné transakci jako vlastní zápis
    (`SetFixed`/`SetSelected` teď proto taky běží v transakci, dřív měly jediný
    `SaveChangesAsync`). Čtení přes `GET /api/audit-log` (`AuditLogController`,
    jen approveři) – filtrovatelné podle `entityId`/`entityType`/`from`/`to`, zatím bez
    vlastní frontendové obrazovky (jde čistě o API/DB vrstvu, dostupnou i pro budoucí
    admin UI nebo přímý dotaz do DB). Zápis jde vypnout v `appsettings.json` (sekce
    `AuditLog:Enabled`, `AuditLogOptions.cs`, výchozí `true`) – `AuditLogService.Log()`
    je při `Enabled: false` no-op (nic nepřidá do change trackeru), čtení přes
    `GET /api/audit-log` zůstává funkční i vypnuté (jen nepřibývají nové záznamy).

## Konvence psaní kódu

- Vlastnosti entit v `Data/Entities` drží název DB sloupce přes `[Column("snake_case")]`,
  ale C# property je PascalCase (např. `id_job_suffix_oper` → `IdJobSuffixOper`) – ať
  je jasná návaznost na DB/Power Fx zdroj.
- DTO v `Dtos/` jsou `record` typy, čtecí DTO používají camelCase názvy odpovídající
  původním sloupcům (System.Text.Json defaultně serializuje C# PascalCase → JSON
  camelCase, není potřeba nic nastavovat).
- Primary constructors (`class Foo(Dep dep)`) a `Services` registrované jako `Scoped`
  (drží `DbContext`), `ApproverService`/`ApproverAuthorizationHandler` jsou `Singleton`
  (proto scoped `DbContext` nesmí jít do jejich konstruktoru – viz `ErrorLoggingExceptionHandler`,
  který si `DbContext` bere přes `IServiceScopeFactory`).

## Práce s databází

- Connection string `ConnectionStrings:BiApp` – SQL Authentication (ne
  `Integrated Security`), `TrustServerCertificate=True` je nutné (viz PRD 8.1).
  Skutečné údaje jen v `appsettings.Development.json` (gitignored) nebo produkčním
  secret store, nikdy v `appsettings.json`.
- Čtecí gridy (`WorkplanController.Get`, `ProducedController.Get`) čtou vždy z views
  (`v_workplan_input`, `t_workplan_produced` přímo dle PRD 6.3) – nikdy neduplikovat
  jejich logiku vlastním SQL/LINQ joinem.
- Zápisy jdou vždy do konkrétní tabulky (`t_workplan_input`, `t_workplan_produced`,
  `t_workplan_reasons`, `t_log_powerapp`, od Fáze 3 i `t_workplan_audit_log`), entity
  pro zápis (`WorkplanInput.cs`, `WorkplanProduced.cs`) mapují jen sloupce, do kterých
  appka skutečně píše – není nutné (ani žádoucí) mapovat celou šířku tabulky.
  `t_workplan_audit_log` je na rozdíl od ostatních tabulka, kterou appka sama zavedla
  (DDL v `backend/sql/`) – přesto se ale řídí stejným pravidlem, appka do ní jen
  vkládá, nikdy needituje ani nemaže.
- Souběžný insert do `t_workplan_reasons` + update `t_workplan_input`/`t_workplan_produced`
  (zápis důvodu) jde v jedné DB transakci (`Database.BeginTransactionAsync`) – viz
  `WorkplanService.SubmitReasonAsync` / `ProducedService.SubmitReasonAsync` (PRD 4.5).
- DB je za VPN – lokální vývoj bez VPN skončí na timeoutu (`db-unreachable` z
  `/api/health`), to není bug v kódu.
- **Pozor na typy sloupců u "podkladových" tabulek** (PRD 4.4 – `t_sequences`,
  `t_jobroute`, `t_divergence_oper`, `t_calendar`, `t_log_sync`, `t_node_definition` –
  appka je nikdy nečetla přímo, takže jejich přesné DDL nemáme). `SqlDataReader` je
  striktní na přesný CLR typ, takže špatný odhad (např. `double?` místo `decimal?`)
  spadne až za běhu na reálné DB s `InvalidCastException` ("Unable to cast object of
  type 'System.Decimal' to type 'System.Double'"), ne při buildu. Narazilo na to
  `SequencesDetail.cs` (qty/hod pole z `t_jobroute`/`t_sequences` jsou `decimal`, ne
  `float` jako ekvivalentní pole v `t_workplan_input`) – oprava: mapovat jako
  `decimal?` v entitě a přetypovat na `double?` až v DTO mapování. Skutečnou chybovou
  hlášku lze dohledat v `t_log_powerapp.error_message` (zapisuje ji
  `ErrorLoggingExceptionHandler`), klientovi jde jen obecná zpráva.

## Zápis důvodu k vyrobené položce (`t_workplan_produced`)

- **Řádek se identifikuje klíčem `id_job_suffix_oper` + `node` + `date`, ne `id`.**
  `t_workplan_produced` se během dne při aktualizaci z ERP TRUNCATE-uje a načítá znovu,
  takže `id` se mění (id z prohlížeče by po refreshi mohlo ukazovat na jiný řádek).
  Endpoint je `POST /api/produced/reason` (tělo `SubmitProducedReasonRequest`),
  `ProducedService.SubmitReasonAsync` aktualizuje všechny řádky odpovídající klíči a
  stejný klíč zapisuje do `t_workplan_reasons` (historie; původní Power Apps appka měla
  tamtéž `id_job_suffix_oper` + `node` + `date`). `date` posílá frontend z řádku, ne z
  filtru. Kdyby se tabulka přesypala mezi SELECT a UPDATE, `DbUpdateConcurrencyException`
  → 404 s vysvětlující hláškou (transakce se vrátí, uživatel zkusí znovu).

## Autentizace a autorizace

- Windows Authentication přes `Microsoft.AspNetCore.Authentication.Negotiate`,
  fallback policy vyžaduje autentizovaného uživatele pro všechno kromě `/api/health`
  (`[AllowAnonymous]`).
- Approver logika (AD skupina NEBO e-mail whitelist) je v `Authorization/ApproverService.cs`
  – sdílená mezi `ApproverAuthorizationHandler` (policy `Approver` na `[Authorize]`)
  a `AuthController.Me()` (`/api/auth/me`, pro frontend aby věděl, co zobrazit).
  **Server je vždy autoritativní** – frontendová kontrola je jen UX, ne bezpečnost.
  `IApproverService.IsApproverAsync` je async jen kvuli rozhrani (implementace je
  synchronni LDAP, `Task.FromResult(...)`) – zamerne se nemenilo zpet na sync, aby se
  neduplikovala zmena na vsech volajicich (`ApproverAuthorizationHandler`,
  `AuthController.Me()`), kdyby se async volani (Graph, LDAP pres sit apod.) v
  budoucnu zase hodilo.
- **`Authorization:ApproverAdGroupId` musí být on-prem AD `objectGUID`, ne Azure AD
  Object ID.** Puvodni Power Apps appka volala
  `Office365Groups.ListGroupMembers("a0b103b0-...")` (Azure AD Object ID, Microsoft
  Graph konektor) – prvni pokus o migraci to omylem prevzal 1:1 a hledal timhle GUID
  v on-prem AD pres `GroupPrincipal.FindByIdentity(..., IdentityType.Guid, ...)`, coz
  skupinu nikdy nenajde (jiny GUID prostor) – `isGroupMember` bylo vzdy `false` pro
  kohokoliv (whitelist tim nebyl dotcen, proto fungoval dal). Docasnou opravou bylo
  overovani pres Microsoft Graph API (Azure AD App Registration, client credentials),
  ale zakaznik pak potvrdil, ze prislusna skupina (`USERS_Plan_sekvenci`) existuje i
  primo v on-prem AD – takze finalni reseni je zpet cista LDAP kontrola
  (`ApproverService.cs`: `GroupPrincipal.FindByIdentity(domainContext,
  IdentityType.Guid, _options.ApproverAdGroupId)` + `userPrincipal.IsMemberOf(group)`),
  bez zavislosti na Graph/Azure AD App Registration/client secret.
  **Prevod raw bajtu objectGUID na standardni GUID string je klasicka chybova past**
  (AD uklada objectGUID v mixed-endian poradi – prvni 3 skupiny bajtu se pri prevodu
  na string obraceji, posledni 8 bajtu ne) – overovat vzdy strojove (`[guid]$bytes` v
  PowerShellu nad presne timito bajty, nebo primo `Get-ADGroup -Identity "..." |
  Select objectGUID`), ne rucnim prepocitavanim.
- Approver-only endpointy (dle PRD sekce 7): `PATCH /api/workplan/{id}/fixed`,
  `POST /api/workplan/{id}/reason`. Ostatní zápisy (`selected`, produced reason)
  jsou otevřené všem přihlášeným uživatelům.
- **Lokální vývoj bez AD/LDAP:** pokud vývojový stroj nemá dosažitelný doménový
  řadič (i přes VPN k DB), `ApproverService` hodí `LdapException: The LDAP server
  is unavailable`. Řešení: `Authorization:BypassAdInDevelopment: true` v
  `appsettings.Development.json` (gitignored, už nastaveno) přepne DI na
  `DevApproverService`, který vrací `true` pro každého přihlášeného uživatele –
  registruje se jen když `IsDevelopment()` **a zároveň** je flag zapnutý (viz
  `Program.cs`), takže to nejde omylem dostat do produkce.

## Testování

- Zatím žádné automatizované testy (Fáze 1 MVP). Při přidávání testů preferovat
  xUnit + `Microsoft.EntityFrameworkCore.InMemory` nebo SQLite in-memory pro services,
  ne testy proti reálné `BI_APP`.

## Časté příkazy

- `dotnet build` / `dotnet run --urls http://localhost:5280` (spustí i Swagger UI
  v Developmentu na `/swagger`).
- Migrace se **nepoužívají** – DB schéma appka nevlastní (`dotnet ef migrations add`
  zde nedává smysl).

## Známé problémy / rozhodnutí

- `user` zapisovaný do `t_workplan_reasons`/`t_log_powerapp` je Windows identity name
  (`DOMAIN\login`), ne plné jméno jako v původní appce (`User().FullName`) – AD lookup
  na FullName by šel doplnit stejným mechanismem jako `ApproverService` (LDAP), zatím
  vyhodnoceno jako zbytečná komplexita pro Fázi 1.
- Server-side stránkování (`page`/`pageSize`, default 100) na `GET /api/workplan` je
  nad rámec doslovného chování originálu (ten stránkoval jen kvůli limitům Power Apps
  a pak filtroval/řadil na klientovi) – jde o modernizaci povolenou PRD sekcí 2,
  neměla by ale měnit vnímané chování pro uživatele.
