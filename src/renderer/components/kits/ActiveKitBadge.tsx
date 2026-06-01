import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { resolveLocalizedText } from '../../services/skill';
import { RootState } from '../../store';
import { toggleActiveKit } from '../../store/slices/kitSlice';
import SidebarKitsIcon from '../icons/SidebarKitsIcon';
import XMarkIcon from '../icons/XMarkIcon';

const ActiveKitBadge: React.FC = () => {
  const dispatch = useDispatch();
  const activeKitIds = useSelector((state: RootState) => state.kit.activeKitIds);
  const marketplaceKits = useSelector((state: RootState) => state.kit.marketplaceKits);

  const activeKits = activeKitIds
    .map(id => marketplaceKits.find(k => k.id === id))
    .filter((k): k is NonNullable<typeof k> => k !== undefined);

  if (activeKits.length === 0) return null;

  const handleRemoveKit = (e: React.MouseEvent, kitId: string) => {
    e.stopPropagation();
    dispatch(toggleActiveKit(kitId));
  };

  return (
    <>
      {activeKits.map(kit => (
        <button
          type="button"
          key={kit.id}
          onClick={(e) => handleRemoveKit(e, kit.id)}
          className="group inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground transition-all hover:bg-primary/15 hover:ring-1 hover:ring-primary/30"
          title={i18nService.t('clearKit')}
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors group-hover:bg-primary/15">
            <SidebarKitsIcon className="h-3.5 w-3.5 text-primary transition-opacity group-hover:opacity-0" />
            <XMarkIcon className="absolute h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="min-w-0 truncate">
            {resolveLocalizedText(kit.name)}
          </span>
        </button>
      ))}
    </>
  );
};

export default ActiveKitBadge;
