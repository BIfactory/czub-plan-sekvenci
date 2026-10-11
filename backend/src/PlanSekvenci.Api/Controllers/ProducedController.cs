using Microsoft.AspNetCore.Mvc;
using PlanSekvenci.Api.Dtos;
using PlanSekvenci.Api.Services;

namespace PlanSekvenci.Api.Controllers;

[ApiController]
[Route("api/produced")]
public class ProducedController(ProducedService producedService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ProducedItemDto>>> Get(
        [FromQuery] DateOnly? date, [FromQuery] string? node, [FromQuery] string? rgid, CancellationToken ct)
    {
        var effectiveDate = date ?? DateOnly.FromDateTime(DateTime.Today);
        return Ok(await producedService.GetAsync(effectiveDate, node, rgid, ct));
    }

    [HttpGet("rgids")]
    public async Task<ActionResult<IReadOnlyList<string>>> GetRgids([FromQuery] string? node, CancellationToken ct) =>
        Ok(await producedService.GetRgidsForNodeAsync(node, ct));

    [HttpGet("overplan")]
    public async Task<ActionResult<IReadOnlyList<OverPlanItemDto>>> GetOverPlan(
        [FromQuery] DateOnly? date, [FromQuery] string? node, [FromQuery] string? rgid, CancellationToken ct)
    {
        var effectiveDate = date ?? DateOnly.FromDateTime(DateTime.Today);
        return Ok(await producedService.GetOverPlanAsync(effectiveDate, node, rgid, ct));
    }

    [HttpGet("summary")]
    public async Task<ActionResult<ProducedSummaryDto>> GetSummary(
        [FromQuery] DateOnly? date, [FromQuery] string? node, [FromQuery] string? rgid, CancellationToken ct)
    {
        var effectiveDate = date ?? DateOnly.FromDateTime(DateTime.Today);
        return Ok(await producedService.GetSummaryAsync(effectiveDate, node, rgid, ct));
    }

    [HttpPost("reason")]
    public async Task<IActionResult> SubmitReason([FromBody] SubmitProducedReasonRequest request, CancellationToken ct)
    {
        var userName = User.Identity?.Name ?? "unknown";
        var result = await producedService.SubmitReasonAsync(
            request.IdJobSuffixOper, request.Node, request.Date, request.Reason, request.Note, userName, ct);
        return result switch
        {
            ReasonSubmitResult.Success => NoContent(),
            ReasonSubmitResult.NotFound => NotFound(new ProblemDetails
            {
                Title = "Záznam nebyl nalezen - data se mezitím aktualizovala. Obnovte stránku a zkuste to znovu.",
            }),
            ReasonSubmitResult.InvalidReason => BadRequest(new ProblemDetails { Title = "Neplatný důvod - musí odpovídat číselníku." }),
            _ => throw new InvalidOperationException(),
        };
    }
}
