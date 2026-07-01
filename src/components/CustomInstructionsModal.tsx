"use client";

import { useState } from "react";
import { Settings, X } from "lucide-react";

type Props = {
  value: string;
  onChange: (val: string) => void;
};

export function CustomInstructionsModal({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <button className="icon-btn" onClick={() => { setDraft(value); setOpen(true); }} title="Custom Instructions">
        <Settings size={18} />
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Custom Instructions</h3>
              <button className="icon-btn" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <p className="modal-desc">These instructions are prepended to the system prompt for every message.</p>
            <textarea
              className="instructions-textarea"
              placeholder="e.g. Always respond in Spanish. Be concise. Use bullet points."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              autoFocus
            />
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
