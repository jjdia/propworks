import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { softDelete } from '../lib/mutations';
import { PropertyFormModal } from '../components/PropertyFormModal';
import { RentalUnitFormModal } from '../components/RentalUnitFormModal';
import type { Property, RentalUnit } from '../lib/types';

const KIND_LABEL: Record<string, string> = {
  apartment: 'Apartment', garage: 'Garage', parking: 'Parking', storage: 'Storage', other: 'Other',
};
const STATUS_COLOR: Record<string, string> = {
  vacant: 'bg-slate-700 text-slate-200',
  occupied: 'bg-emerald-900 text-emerald-200',
  available: 'bg-sky-900 text-sky-200',
  advertising: 'bg-amber-900 text-amber-200',
};

export function Properties() {
  const [modalTarget, setModalTarget] = useState<Property | 'new' | null>(null);
  const [unitModal, setUnitModal] = useState<{ propertyId: string; existing?: RentalUnit } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const properties = useLiveQuery(
    () => db.properties.filter((p) => !p.deleted_at).sortBy('name'),
    [],
  );
  const units = useLiveQuery(() => db.rental_units.filter((u) => !u.deleted_at).toArray(), []);

  const expensesByProperty = useLiveQuery(async () => {
    const all = await db.expenses.filter((e) => !e.deleted_at).toArray();
    const map: Record<string, number> = {};
    for (const e of all) map[e.property_id] = (map[e.property_id] ?? 0) + Number(e.amount);
    return map;
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Properties</h1>
        <button
          onClick={() => setModalTarget('new')}
          className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium"
        >
          + Add
        </button>
      </div>

      {properties?.length === 0 && (
        <p className="text-slate-400 text-sm">No properties yet. Add your first one.</p>
      )}

      <div className="space-y-3">
        {properties?.map((p) => {
          const propertyUnits = units?.filter((u) => u.property_id === p.id) ?? [];
          const isExpanded = expanded.has(p.id);
          return (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{p.name}</h3>
                  <p className="text-xs text-slate-400">
                    {[p.address_line, p.city, p.state].filter(Boolean).join(', ')}
                  </p>
                  {p.property_type && (
                    <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                      {p.property_type}
                    </span>
                  )}
                </div>
                <div className="text-right text-sm">
                  <div className="text-slate-400 text-xs">Expenses recorded</div>
                  <div className="font-mono">${(expensesByProperty?.[p.id] ?? 0).toFixed(2)}</div>
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <button onClick={() => setModalTarget(p)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">Edit</button>
                <button onClick={() => toggle(p.id)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                  {isExpanded ? 'Hide units' : `Units (${propertyUnits.length})`}
                </button>
                <button
                  onClick={() => { if (confirm(`Remove ${p.name}? It can be recovered later.`)) softDelete('properties', p.id); }}
                  className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1"
                >
                  Delete
                </button>
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                  {propertyUnits.length === 0 && <p className="text-xs text-slate-500">No units yet — add Unit 1, Unit 2, a garage, etc.</p>}
                  {propertyUnits.map((u) => (
                    <div key={u.id} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
                      <div>
                        <span className="text-sm">{u.name}</span>
                        <span className="text-[10px] text-slate-400 ml-2">{KIND_LABEL[u.unit_kind]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_COLOR[u.status]}`}>{u.status}</span>
                        <button onClick={() => setUnitModal({ propertyId: p.id, existing: u })} className="text-xs text-slate-400 hover:text-slate-200">Edit</button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setUnitModal({ propertyId: p.id })}
                    className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1.5 w-full"
                  >
                    + Add unit (apartment, garage, parking…)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modalTarget && (
        <PropertyFormModal
          existing={modalTarget === 'new' ? undefined : modalTarget}
          onClose={() => setModalTarget(null)}
        />
      )}
      {unitModal && (
        <RentalUnitFormModal
          propertyId={unitModal.propertyId}
          existing={unitModal.existing}
          onClose={() => { setUnitModal(null); setExpanded((prev) => new Set(prev).add(unitModal.propertyId)); }}
        />
      )}
    </div>
  );
}
