import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import VoicePage from './pages/VoicePage'
import DualDisplayPage from './pages/DualDisplayPage'
import WhyFreePage from './pages/WhyFreePage'
import ComparePage from './pages/ComparePage'
import StoryPage from './pages/StoryPage'
import GuidePage from './pages/GuidePage'
import ChangelogPage from './pages/ChangelogPage'
import './index.css'

function App() {
  // HashRouter：GitHub Pages 靜態托管下，子路由直接重整不會 404
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="/why" element={<WhyFreePage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/story" element={<StoryPage />} />
        <Route path="/voice" element={<VoicePage />} />
        <Route path="/dual" element={<DualDisplayPage />} />
      </Routes>
    </HashRouter>
  )
}

export default App
