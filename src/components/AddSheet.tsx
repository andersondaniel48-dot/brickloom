import { Package, Shapes } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { usePartPanel } from './AddPartPanel.tsx';
import { useSetPanel } from './AddSetPanel.tsx';
import { Segmented, Sheet } from './ui.tsx';

export type AddMode = 'pieces' | 'sets';

/** What one way of adding to the collection shows inside the sheet. */
export interface AddPanel {
  /** Title while something is picked; null on the panel's search screen. */
  title: ReactNode | null;
  body: ReactNode;
  footer?: ReactNode;
}

/** Add to the collection without scanning: one kind of piece at a time, or a whole set at once. */
export function AddSheet({ open, mode: initialMode, onClose }: { open: boolean; mode: AddMode; onClose: () => void }) {
  const [mode, setMode] = useState<AddMode>(initialMode);
  // Each time the sheet opens it starts on whichever way of adding the opener asked for.
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  const pieces = usePartPanel(open && mode === 'pieces');
  const sets = useSetPanel(open && mode === 'sets');
  const panel = mode === 'pieces' ? pieces : sets;

  return (
    <Sheet open={open} onClose={onClose} wide title={panel.title ?? 'Add to collection'} footer={panel.footer}>
      {panel.title === null && (
        <Segmented<AddMode>
          className="mb-3 w-full"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pieces', label: <Tab icon={<Shapes className="size-4" />}>Single pieces</Tab> },
            { value: 'sets', label: <Tab icon={<Package className="size-4" />}>Whole sets</Tab> },
          ]}
        />
      )}
      {panel.body}
    </Sheet>
  );
}

function Tab({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-2">
      {icon}
      {children}
    </span>
  );
}
