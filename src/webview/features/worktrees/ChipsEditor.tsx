import { useState } from 'react';

/** A small list editor: values as removable chips, plus a field to add one. */
export function ChipsEditor({
  values,
  onChange,
  placeholder,
  label,
  onBrowse,
}: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  label: string;
  /** Offers a Browse… button that adds a picked folder. */
  onBrowse?: () => Promise<string | undefined>;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || values.includes(trimmed)) return setDraft('');
    onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div className="gt-chips" aria-label={label}>
      {values.map((value) => (
        <span key={value} className="gt-chip">
          <span className="gt-mono">{value}</span>
          <button type="button" className="gt-chip-remove" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="gt-chip-input"
        placeholder={placeholder}
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
      />
      {onBrowse && (
        <button
          type="button"
          className="gt-button"
          data-size="small"
          onClick={() => {
            void onBrowse().then((picked) => {
              if (picked) add(picked);
            });
          }}
        >
          Browse…
        </button>
      )}
    </div>
  );
}
