import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AgentChatPage } from "../features/agent-chat/AgentChatPage.js";
import { ExplorePage } from "../features/explore/ExplorePage.js";
import { JourneyPage } from "../features/journey/JourneyPage.js";
import { WelcomePage } from "../features/onboarding/WelcomePage.js";
import { PersonaPage } from "../features/persona/PersonaPage.js";
import { ProfilePage } from "../features/profile/ProfilePage.js";
import { RelationshipsPage } from "../features/relationships/RelationshipsPage.js";

const navigation = [
  ["/explore", "远行"],
  ["/agent-chat", "同行"],
  ["/relationships", "关系"],
  ["/profile", "我的手记"],
] as const;

export function App(): React.JSX.Element {
  const location = useLocation();
  const immersive = location.pathname === "/" || location.pathname === "/journey";

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Reso.AI 首页">
          <span className="brand-mark" aria-hidden="true" />
          Reso.AI
        </Link>
        <span className="topbar-note">Understand · Remember · Grow</span>
      </header>

      <main className={immersive ? "main main--immersive" : "main"}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/journey" element={<JourneyPage />} />
          <Route path="/persona" element={<PersonaPage />} />
          <Route path="/agent-chat" element={<AgentChatPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/relationships" element={<RelationshipsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!immersive && (
        <nav className="bottom-nav" aria-label="主要导航">
          {navigation.map(([path, label]) => (
            <Link
              className={
                location.pathname === path ? "bottom-nav__item is-active" : "bottom-nav__item"
              }
              to={path}
              key={path}
            >
              <span className="bottom-nav__dot" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
