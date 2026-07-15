import React from 'react';

const AppUpdateInteractionOverlay: React.FC = () => (
  <div
    className="absolute inset-0 z-40 cursor-wait bg-white/75 dark:bg-background/80"
    aria-hidden="true"
  />
);

export default AppUpdateInteractionOverlay;
