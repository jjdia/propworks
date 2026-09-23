import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { softDelete } from '../lib/mutations';
import { Link } from 'react-router-dom';

const TYPE_LABEL: Record<string, string> = {
  lease: 'Lease', contract: 'Contract', notice: 'Notice', receipt: 'Receipt/Invoice',
  insurance: 'Insurance', tax: 'Tax', other: 'Other',
};

export function Documents() {
  const documents = useLiveQuery(() => db.documents.filter((d) => !d.deleted_at).reverse().sortBy('created_at'), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? 'Unknown property';

  function downloadText(title: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title.replace(/[^a-z0-9]+/gi, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Documents</h1>
        <Link to="/lease-generator" className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
          + New lease
        </Link>
      </div>

      {documents?.length === 0 && <p className="text-slate-400 text-sm">No documents saved yet.</p>}

      <div className="space-y-2">
        {documents?.map((d) => (
          <div key={d.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium">{d.title}</div>
                <div className="text-xs text-slate-400">{propertyName(d.property_id)} · {TYPE_LABEL[d.doc_type]} · {d.created_at.slice(0, 10)}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => downloadText(d.title, d.content)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                Download text
              </button>
              <button
                onClick={() => { if (confirm('Remove this document?')) softDelete('documents', d.id); }}
                className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
