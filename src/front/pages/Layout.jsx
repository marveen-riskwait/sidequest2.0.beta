import { Outlet, useLocation } from "react-router-dom";
import ScrollToTop from "../components/ScrollToTop";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { BottomNavbar } from "../components/ButtonNavbar";
import { SiteFooter } from "../components/SiteFooter";

// Base component that maintains the navbar and footer throughout the page
// and the scroll-to-top functionality.
//
// On the landing ("/") and the auth pages (/login, /register) we hide both
// navbars so each of those screens owns the whole viewport — the landing
// has its own black header, and the auth screens are fullscreen dark.
const NAV_FREE_PATHS = ["/", "/login", "/register"];

export const Layout = () => {
    const location = useLocation();
    const hideNav = NAV_FREE_PATHS.includes(location.pathname);

    return (
        <ScrollToTop>
            {/* SEMÁNTICA: el Navbar es semánticamente un <header> global
                (lo envolvemos dentro del propio componente Navbar para
                no duplicarlo aquí). Aquí marcamos el área principal con
                <main role="main"> — Google y los lectores de pantalla
                saltan directamente al contenido cuando el usuario pulsa
                "saltar a contenido". UN <main> por página es el
                estándar HTML5; por eso LandingPage cambia su <main>
                interno a <section> para no anidar dos <main>. */}
            {!hideNav && <Navbar />}
            <main id="main-content" role="main">
                <Outlet />
            </main>
            {/* SiteFooter: enlaces legales (Terms / Privacy / Legal Notice)
                + copyright. Aparece en todas las páginas EXCEPTO:
                  - "/"      → landing tiene su propio lp-footer
                  - "/app"   → mapa fullscreen, no scrollea
                  - "/map"   → idem
                  - "/login", "/register" → auth screens fullscreen
                El propio componente decide ocultarse en esas rutas via
                HIDE_ON_PATHS, así que aquí lo montamos siempre.
                Los enlaces legales SIEMPRE son accesibles desde el
                hamburger menu del Navbar incluso cuando el footer no
                se renderiza (mapa).                                       */}
            <SiteFooter />
            {!hideNav && <BottomNavbar />}
        </ScrollToTop>
    );
};
