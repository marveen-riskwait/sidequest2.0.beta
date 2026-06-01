import { useState } from "react";

import { Navbar } from "../components/Navbar";
import { Mapview } from "../components/Mapview";
import EventCard from "../components/EventCard";
import { BottomNavbar } from "../components/ButtonNavbar";

export const Home = () => {
	const user = JSON.parse(localStorage.getItem("user"));

	const [showModal, setShowModal] = useState(false);
	const [createEventData, setCreateEventData] = useState({});
	const [selectedEvent, setSelectedEvent] = useState(null);

	return (
		<div className="home-page">

			<Navbar />

			<div className="container mt-3">
				<h4>
					Hola {user?.email}
				</h4>
			</div>

			<Mapview
				setSelectedEvent={setSelectedEvent}
				setCreateEventData={(coords) => {
					setCreateEventData(coords);
					setShowModal(true);
				}}
			/>

			<EventCard
				show={showModal}
				handleClose={() => {
					setShowModal(false);
					setCreateEventData({});
				}}
				eventData={createEventData}
			/>

			{selectedEvent && (
				<div>
				</div>
			)}

			<BottomNavbar />

		</div>
	);
};