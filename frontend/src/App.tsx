import { Route, Routes, useLocation } from "react-router-dom";
import { Sidebar } from "./components/layout/Sidebar";
import { useJobEvents } from "./lib/events";
import Dashboard from "./pages/Dashboard";
import ProjectPage from "./pages/ProjectPage";
import HighlightsPage from "./pages/HighlightsPage";
import EditorPage from "./editor/EditorPage";
import ExportCentre from "./pages/ExportCentre";
import SocialPage from "./pages/SocialPage";
import LibraryPage from "./pages/LibraryPage";
import BrandKitsPage from "./pages/BrandKitsPage";
import SettingsPage from "./pages/SettingsPage";
import NewProjectPage from "./pages/NewProjectPage";

export default function App() {
  useJobEvents();
  const loc = useLocation();
  const editor = loc.pathname.startsWith("/editor/");
  return (
    <div className="flex h-full min-h-0">
      <Sidebar compact={editor} />
      <main className={editor ? "min-w-0 flex-1 overflow-hidden" : "min-w-0 flex-1 overflow-y-auto"}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewProjectPage />} />
          <Route path="/projects/:pid" element={<ProjectPage />} />
          <Route path="/projects/:pid/highlights" element={<HighlightsPage />} />
          <Route path="/editor/:eid" element={<EditorPage />} />
          <Route path="/export" element={<ExportCentre />} />
          <Route path="/social" element={<SocialPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/brand-kits" element={<BrandKitsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="p-8 text-sub">Page not found.</div>} />
        </Routes>
      </main>
    </div>
  );
}
