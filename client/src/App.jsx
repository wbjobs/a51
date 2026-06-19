import { Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import MeetingRoom from './pages/MeetingRoom'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <Link to="/" className="logo">
            <span className="logo-icon">📅</span>
            <span className="logo-text">会议协作系统</span>
          </Link>
          <nav className="nav-links">
            <Link to="/" className="nav-link">会议列表</Link>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/meeting/:id" element={<MeetingRoom />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
