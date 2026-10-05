import React from 'react';
import {createRoot} from 'react-dom/client';
import CatalogApp from '../components/catalog/CatalogApp';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><CatalogApp/></React.StrictMode>);
