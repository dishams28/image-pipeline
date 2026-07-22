const express = require("express");
const router = express.Router();

router.post("/upload", (req, res) => {
    res.json({
        success: true,
        message: "Image upload endpoint is working"
    });
});

module.exports = router;