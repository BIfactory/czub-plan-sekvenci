using System.ComponentModel.DataAnnotations;

namespace PlanSekvenci.Api.Dtos;

// Zapis duvodu k vyrobene polozce. Radek se identifikuje prirozenym klicem
// id_job_suffix_oper + node + date, NE technickym id - t_workplan_produced se behem dne
// pri aktualizaci z ERP TRUNCATE-uje a nacita znovu, takze id se meni a stary id z
// prohlizece by po refreshi mohl ukazovat na uplne jiny radek. Atributy bez "property:"
// cile - viz poznamka u SubmitReasonRequest.
public record SubmitProducedReasonRequest(
    [Required, MaxLength(100)] string IdJobSuffixOper,
    [Required, MaxLength(150)] string Node,
    DateOnly Date,
    [MaxLength(100)] string? Reason,
    [MaxLength(600)] string? Note);

// Radek gridu "Vyhodnoceni" (PRD 6.4).
public record ProducedItemDto(
    long Id,
    DateOnly? Date,
    string? IdJobSuffixOper,
    string? Item,
    // Popis polozky (t_item.description) - t_workplan_produced sam o sobe zadny
    // popis nema, viz Item.cs.
    string? ItemDesc,
    double? QtyTodo,
    double? QtyDone,
    double? HodPlan,
    double? HodProduced,
    string? Node,
    int? Produced,
    DateTime? SequenceDateTime,
    int? Status,
    string? Reason,
    string? ReasonNote,
    DateTime? ReasonLastUpdateTime,
    string? ReasonLastUpdateBy,
    int? ReasonEnabled,
    string? Rgid,
    int? SelectedOper,
    // Priorita (PRD 6.4 doplnek) - "P" priznak ve sloupci Status, stejny jako mprio
    // priznak na Plan sekvenci (viz Vyhodnocení.pa.yaml: If(ThisItem.prio = 1, "P", "")).
    int? Prio
);

// Panel "Vyhodnoceni nad plan nebo mimo plan" (druhy grid, Gallery3_2 v puvodni
// appce) - polozky vyrobene nad ramec nebo mimo dnesni plan (status 3/4).
public record OverPlanItemDto(
    long Id,
    string? IdJobSuffixOper,
    string? Item,
    string? ItemDesc,
    int? Status,
    string? StatusDesc,
    DateTime? SequenceDateTime,
    double? HodProduced,
    double? QtyDone,
    int? Prio
);

// Panel "Vyhodnoceni planu:" + "Graf vyhodnoceni" - souhrn za vybrany den/uzel(/rgid).
public record ProducedSummaryDto(
    double? PlanHod,
    double? ProducedInPlanHod,
    double? ProducedOverPlanHod,
    double? ProducedOutOfPlanHod,
    double? CapacityHod,
    double? Sa,
    double? Performance
);
