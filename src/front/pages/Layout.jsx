import { Outlet, useLocation } from "react-router-dom";
import ScrollToTop from "../components/ScrollToTop";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { BottomNavbar } from "../components/ButtonNavbar";
// Base component that maintains the navbar and footer throughout the page
// and the scroll-to-top functionality.
//
// On the auth pages (/login and /register) we hide both navbars so the
// auth screen takes the whole viewport — coherent with the fullscreen
// dark Login design.
const NAV_FREE_PATHS = ["/login", "/register"];

export const Layout = () => {
    const location = useLocation();
    const hideNav = NAV_FREE_PATHS.includes(location.pathname);

    return (
        <ScrollToTop>
            {!hideNav && <Navbar />}
            <Outlet />
            {!hideNav && <BottomNavbar />}
        </ScrollToTop>
    );
};
