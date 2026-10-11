using Microsoft.EntityFrameworkCore;
using PlanSekvenci.Api.Data;
using PlanSekvenci.Api.Data.Entities;
using PlanSekvenci.Api.Dtos;

namespace PlanSekvenci.Api.Services;

public class ProducedService(BiAppDbContext db, AuditLogService auditLog)
{
    // PRD 6.3: t_workplan_produced filtrovano na datum + node + rgid, kde
    // (status = 1 OR selected_oper = 1) OR status = 2 OR status = 5,
    // razeno sestupne dle status, vzestupne dle id_job_suffix_oper.
    public async Task<IReadOnlyList<ProducedItemDto>> GetAsync(DateOnly date, string? node, string? rgid, CancellationToken ct)
    {
        var query = db.WorkplanProduced.AsNoTracking()
            .Where(x => x.Date == date)
            .Where(x => (x.Status == 1 || x.SelectedOper == 1) || x.Status == 2 || x.Status == 5);

        if (!string.IsNullOrEmpty(node))
        {
            query = query.Where(x => x.Node == node);
        }
        if (!string.IsNullOrEmpty(rgid))
        {
            query = query.Where(x => x.Rgid == rgid);
        }

        var rows = await query
            .OrderByDescending(x => x.Status)
            .ThenBy(x => x.IdJobSuffixOper)
            .ToListAsync(ct);

        var itemDescriptions = await GetItemDescriptionsAsync(rows.Select(x => x.Item), ct);
        return rows.Select(x => ToDto(x, itemDescriptions.GetValueOrDefault(x.Item ?? ""))).ToList();
    }

    // PRD 6.5 + Vyhodnocení.pa.yaml (Gallery3_2) - polozky vyrobene nad planem nebo
    // mimo plan (nezobrazuji se v hlavnim gridu, jen v tomto doplnkovem seznamu).
    public async Task<IReadOnlyList<OverPlanItemDto>> GetOverPlanAsync(DateOnly date, string? node, string? rgid, CancellationToken ct)
    {
        var query = db.WorkplanProduced.AsNoTracking()
            .Where(x => x.Date == date)
            .Where(x => (x.Status == 3 && x.SelectedOper == null) || x.Status == 4);

        if (!string.IsNullOrEmpty(node))
        {
            query = query.Where(x => x.Node == node);
        }
        if (!string.IsNullOrEmpty(rgid))
        {
            query = query.Where(x => x.Rgid == rgid);
        }

        var rows = await query
            .OrderByDescending(x => x.Status)
            .ThenBy(x => x.IdJobSuffixOper)
            .ToListAsync(ct);

        var itemDescriptions = await GetItemDescriptionsAsync(rows.Select(x => x.Item), ct);
        return rows.Select(x => new OverPlanItemDto(
            x.Id, x.IdJobSuffixOper, x.Item, itemDescriptions.GetValueOrDefault(x.Item ?? ""),
            x.Status, x.StatusDesc, x.SequenceDateTime, x.HodProduced, x.QtyDone, x.Prio)).ToList();
    }

    // Popisy polozek (t_item.description) pro sadu item kodu - viz Item.cs (PRD
    // 6.4 doplnek, t_workplan_produced sam o sobe zadny popis nema).
    private async Task<Dictionary<string, string?>> GetItemDescriptionsAsync(IEnumerable<string?> itemCodes, CancellationToken ct)
    {
        var codes = itemCodes.Where(x => !string.IsNullOrEmpty(x)).Distinct().ToList();
        if (codes.Count == 0)
        {
            return new Dictionary<string, string?>();
        }

        return await db.Items.AsNoTracking()
            .Where(x => codes.Contains(x.ItemCode))
            .ToDictionaryAsync(x => x.ItemCode, x => x.Description, ct);
    }

    // Panel "Vyhodnoceni planu:" + "Graf vyhodnoceni" (Vyhodnocení.pa.yaml, Group10) -
    // souhrn plan/vyrobeno/nad plan/mimo plan + kapacita + SA za vybrany den/uzel(/rgid).
    public async Task<ProducedSummaryDto> GetSummaryAsync(DateOnly date, string? node, string? rgid, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(node))
        {
            return new ProducedSummaryDto(null, null, null, null, null, null, null);
        }

        var scoped = db.WorkplanProduced.AsNoTracking().Where(x => x.Date == date && x.Node == node);
        if (!string.IsNullOrEmpty(rgid))
        {
            scoped = scoped.Where(x => x.Rgid == rgid);
        }

        var planHod = await scoped.Where(x => x.Status == 1 || x.Status == 2).SumAsync(x => (double?)x.HodPlan, ct);
        var producedInPlanHod = await scoped.Where(x => x.Status == 1 || x.SelectedOper == 1).SumAsync(x => (double?)x.HodProduced, ct);
        var producedOverPlanHod = await scoped.Where(x => x.Status == 3).SumAsync(x => (double?)x.HodProduced, ct);
        var producedOutOfPlanHod = await scoped.Where(x => x.Status == 4).SumAsync(x => (double?)x.HodProduced, ct);

        double? capacityHod;
        double? sa = null;
        double? performance = null;

        if (!string.IsNullOrEmpty(rgid))
        {
            var dateRgid = $"{date:yyyy-MM-dd}-{rgid}";
            capacityHod = await db.RgidCapToday.AsNoTracking().Where(x => x.DateRgid == dateRgid).MaxAsync(x => (double?)x.Cap, ct);
            var saRow = await db.SaRgidLastValid.AsNoTracking().FirstOrDefaultAsync(x => x.Date == date && x.Rgid == rgid && x.Node == node, ct);
            sa = saRow?.Sa;
            performance = saRow?.Performance;
        }
        else
        {
            var dateNode = $"{date:yyyy-MM-dd}-{node}";
            capacityHod = await db.NodeCapToday.AsNoTracking().Where(x => x.DateNode == dateNode).MaxAsync(x => (double?)x.Cap, ct);
            var saRow = await db.SaLastValid.AsNoTracking().FirstOrDefaultAsync(x => x.Date == date && x.Node == node, ct);
            sa = saRow?.Sa;
            performance = saRow?.Performance;
        }

        return new ProducedSummaryDto(planHod, producedInPlanHod, producedOverPlanHod, producedOutOfPlanHod, capacityHod, sa, performance);
    }

    public async Task<IReadOnlyList<string>> GetRgidsForNodeAsync(string? node, CancellationToken ct)
    {
        var query = db.WorkplanProduced.AsNoTracking().Where(x => x.Rgid != null && x.Rgid != "");
        if (!string.IsNullOrEmpty(node))
        {
            query = query.Where(x => x.Node == node);
        }

        return await query.Select(x => x.Rgid!).Distinct().OrderBy(x => x).ToListAsync(ct);
    }

    // PRD 6.6: insert do t_workplan_reasons, update t_workplan_produced a zapis do audit
    // logu v jedne transakci. Faze 3 - Reason musi byt prazdny nebo odpovidat ciselniku
    // dim_workplan_reasons (viz WorkplanService.SubmitReasonAsync - stejne pravidlo).
    //
    // Radek se hleda podle id_job_suffix_oper + node + date, ne podle id: t_workplan_produced
    // se behem dne pri aktualizaci z ERP TRUNCATE-uje, takze id se meni a id z prohlizece by
    // po refreshi mohlo ukazovat na jiny radek. Stejny klic pouziva t_workplan_reasons
    // (historie), takze oba zapisy zustavaji konzistentni. Kdyby klicu odpovidalo vic
    // radku (napr. ruzne rgid), aktualizuji se vsechny - jde o stejnou operaci/uzel/den.
    public async Task<ReasonSubmitResult> SubmitReasonAsync(
        string idJobSuffixOper, string node, DateOnly date, string? reason, string? note, string userName, CancellationToken ct)
    {
        var entities = await db.WorkplanProduced
            .Where(x => x.IdJobSuffixOper == idJobSuffixOper && x.Node == node && x.Date == date)
            .ToListAsync(ct);
        if (entities.Count == 0)
        {
            return ReasonSubmitResult.NotFound;
        }

        if (!string.IsNullOrEmpty(reason) && !await db.WorkplanReasonDims.AsNoTracking().AnyAsync(x => x.Desc == reason, ct))
        {
            return ReasonSubmitResult.InvalidReason;
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var first = entities[0];
        var oldValue = $"reason: {first.Reason ?? "-"} | note: {first.ReasonNote ?? ""}";
        var newValue = $"reason: {(string.IsNullOrEmpty(reason) ? "-" : reason)} | note: {note ?? ""}";

        db.WorkplanReasons.Add(new WorkplanReason
        {
            TimeStamp = DateTime.Now,
            IdJobSuffixOper = idJobSuffixOper,
            Node = node,
            Reason = string.IsNullOrEmpty(reason) ? "-" : reason,
            Note = note,
            User = userName,
            Date = date,
        });

        var now = DateTime.Now;
        foreach (var entity in entities)
        {
            entity.Reason = reason;
            entity.ReasonNote = note;
            entity.ReasonLastUpdateTime = now;
            entity.ReasonLastUpdateBy = userName;
        }

        // entity_id je nvarchar(100) - prirozeny klic je v praxi hluboko pod limitem, orez je jen pojistka.
        var auditEntityId = $"{idJobSuffixOper}|{node}|{date:yyyy-MM-dd}";
        auditLog.Log(userName, "reason", "produced", auditEntityId.Length > 100 ? auditEntityId[..100] : auditEntityId, node, oldValue, newValue);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Tabulka se mezi SELECT a UPDATE znovu naplnila (TRUNCATE + load z ERP) - radek
            // s puvodnim id uz neexistuje. Transakce se vrati zpet, uzivatel to zkusi znovu.
            return ReasonSubmitResult.NotFound;
        }

        await transaction.CommitAsync(ct);
        return ReasonSubmitResult.Success;
    }

    private static ProducedItemDto ToDto(WorkplanProduced x, string? itemDesc) => new(
        x.Id,
        x.Date,
        x.IdJobSuffixOper,
        x.Item,
        itemDesc,
        x.QtyTodo,
        x.QtyDone,
        x.HodPlan,
        x.HodProduced,
        x.Node,
        x.Produced,
        x.SequenceDateTime,
        x.Status,
        x.Reason,
        x.ReasonNote,
        x.ReasonLastUpdateTime,
        x.ReasonLastUpdateBy,
        x.ReasonEnabled,
        x.Rgid,
        x.SelectedOper,
        x.Prio
    );
}
