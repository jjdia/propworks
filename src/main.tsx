import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { RecoveryBoundary } from './components/RecoveryBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoveryBoundary>
      <App />
    </RecoveryBoundary>
  </StrictMode>,
);
