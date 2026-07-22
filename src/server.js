const express = require("express");
const routes = require("./routes/routes");


const app = express();

app.use(express.json());
app.use("/api", routes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Vehicle Image Pipeline API Running"
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});