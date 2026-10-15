import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './app/globals.css';
import { DashboardPage } from './app/page';

const root = document.getElementById('interactive-root');
if (!root) throw new Error('화면을 표시할 영역이 없습니다.');
const rootElement = root;
const data = JSON.parse(document.getElementById('tic-data')?.textContent || 'null');
if (!data) throw new Error('화면 데이터가 없습니다.');

function InteractiveDashboard() {
  useEffect(() => {
    const staticRoot = document.getElementById('static-root');
    rootElement.hidden = false;
    if (staticRoot) staticRoot.hidden = true;
  }, []);
  return <DashboardPage data={data} />;
}

createRoot(root).render(<InteractiveDashboard />);
