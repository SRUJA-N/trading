// Import necessary libraries from React and third-party packages
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Line } from "react-chartjs-2"; // Component for the line chart
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js"; // Required components for Chart.js
import "./Dashboard.css"; // Your custom styles for the dashboard

// Register the necessary components for Chart.js to work
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

export default function Dashboard() {
  // --- STATE MANAGEMENT ---
  const [user, setUser] = useState(null); // Holds the logged-in user's data
  const [stockData, setStockData] = useState(null); // Holds the latest live data from the WebSocket
  const [lastPrice, setLastPrice] = useState(null); // Stores the previous price to determine color (up/down)
  const [quantity, setQuantity] = useState(1); // Manages the quantity input for trades
  const [portfolio, setPortfolio] = useState([]); // Holds the user's current stock holdings
  const [tradeHistory, setTradeHistory] = useState([]); // Holds the user's past trades
  const [error, setError] = useState(""); // For displaying any errors to the user
  const [priceHistory, setPriceHistory] = useState([]); // An array to store the last 20 price points for the chart

  const token = localStorage.getItem("token"); // Get the authentication token from browser storage

  // --- DATA FETCHING & REAL-TIME CONNECTION ---

  // This useEffect hook fetches the initial, protected data when the component first loads
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Use Promise.all to make multiple API calls concurrently for efficiency
        const [userRes, portfolioRes, historyRes] = await Promise.all([
          axios.get("http://localhost:8000/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get("http://localhost:8000/portfolio", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get("http://localhost:8000/trade-history", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        // Update the state with the fetched data
        setUser(userRes.data);
        setPortfolio(portfolioRes.data);
        setTradeHistory(historyRes.data);
      } catch (err) {
        setError(
          "Failed to load initial data. Please try logging in again."
        );
        console.error(err);
      }
    };
    fetchData();
  }, [token]); // This effect depends on the token

  // This useEffect hook establishes and manages the WebSocket connection for real-time data
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws");

    // Define what happens when a new message is received from the server
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastPrice((prev) => (prev !== null ? prev : data.price)); // Update the last known price
      setStockData(data); // Update the current stock data
      
      // Update the price history for the chart, keeping only the last 20 data points
      setPriceHistory((prev) => {
        const newHistory = [...prev, data.price];
        if (newHistory.length > 20) newHistory.shift(); // Keep last 20 points
        return newHistory;
      });
    };

    // Define what happens when the connection closes
    ws.onclose = () => setStockData(null);

    // Cleanup function: This will run when the component unmounts to prevent memory leaks
    return () => ws.close();
  }, []); // The empty dependency array means this effect runs only once

  // --- TRADE LOGIC ---

  // This function handles the "BUY" or "SELL" trade execution
  const handleTrade = async (type) => {
    if (!stockData) return; // Don't trade if there's no live data
    try {
      // Send the trade request to the backend API
      await axios.post(
        "http://localhost:8000/trade",
        {
          symbol: stockData.stock,
          trade_type: type,
          quantity: parseInt(quantity),
          price: parseFloat(stockData.price),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // After a successful trade, re-fetch the portfolio and history to show the updated data
      const [portfolioRes, historyRes] = await Promise.all([
        axios.get("http://localhost:8000/portfolio", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get("http://localhost:8000/trade-history", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setPortfolio(portfolioRes.data);
      setTradeHistory(historyRes.data);
    } catch (err) {
      alert(err.response?.data?.detail || "Trade failed!");
      console.error(err);
    }
  };

  // --- CHART CONFIGURATION ---

  // Prepare the data object for the Line chart component
  const lineChartData = {
    labels: priceHistory.map((_, i) => i + 1),
    datasets: [
      {
        label: "Price",
        data: priceHistory,
        borderColor: "#26a69a",
        backgroundColor: "rgba(38, 166, 154, 0.2)",
        tension: 0.3,
        fill: true,
      },
    ],
  };

  // Prepare the options object for the Line chart component to control its appearance
  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: "index" } },
    scales: {
      x: { ticks: { color: "#d1d4dc" }, grid: { color: "#2a2e39" } },
      y: { ticks: { color: "#d1d4dc" }, grid: { color: "#2a2e39" } },
    },
    layout: { padding: { left: 10, right: 10, top: 10, bottom: 10 } },
  };

  // --- RENDER LOGIC ---

  // Show loading or error states before rendering the main dashboard
  if (error) return <div className="dashboard-container">{error}</div>;
  if (!user) return <div className="dashboard-container">Loading...</div>;

  // The main JSX for the dashboard UI
  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Paper Trading Platform</h1>
        <div className="user-info">{user.email}</div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-top">
          {/* Stock Panel */}
          <div className="stock-panel">
            <h3>Live Market</h3>
            {stockData ? (
              <>
                <h2>{stockData.stock}</h2>
                <p
                  className={`price ${
                    stockData.price > lastPrice ? "up" : "down"
                  }`}
                >
                  ${stockData.price.toFixed(2)}
                </p>
                <p
                  className={`change ${
                    stockData.change_percent >= 0 ? "up" : "down"
                  }`}
                >
                  {stockData.change_percent >= 0 ? "▲" : "▼"}{" "}
                  {stockData.change_percent}%
                </p>
                <p className="volume">Volume: {stockData.volume}</p>
                <div className="line-chart-container">
                  <Line data={lineChartData} options={lineChartOptions} />
                </div>
              </>
            ) : (
              <p>❌ Disconnected</p>
            )}
          </div>

          {/* Trade Panel */}
          <div className="trade-panel">
            <h3>Place Order</h3>
            <input
              type="number"
              value={quantity}
              min="1"
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Quantity"
            />
            <div className="trade-buttons">
              <button className="buy-btn" onClick={() => handleTrade("BUY")}>
                Buy
              </button>
              <button className="sell-btn" onClick={() => handleTrade("SELL")}>
                Sell
              </button>
            </div>
          </div>
        </div>

        {/* Portfolio Table */}
        <div className="table-container">
          <h3>Your Portfolio</h3>
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Quantity</th>
                <th>Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.map((p) => (
                <tr key={p.id}>
                  <td>{p.symbol}</td>
                  <td>{p.quantity}</td>
                  <td>${p.avg_price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Trade History Table */}
        <div className="table-container">
          <h3>Trade History</h3>
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.map((t) => (
                <tr key={t.id}>
                  <td>{t.symbol}</td>
                  <td
                    style={{
                      color: t.trade_type === "BUY" ? "#26a69a" : "#ef5350",
                      fontWeight: "bold",
                    }}
                  >
                    {t.trade_type}
                  </td>
                  <td>{t.quantity}</td>
                  <td>${t.price.toFixed(2)}</td>
                  <td>{new Date(t.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}