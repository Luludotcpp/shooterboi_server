const app = require("express")();
const path = require("path");

const rootDirectory = path.join(__dirname , "..");
app.get(/.*$/, (req, res) => {
    res.sendFile(path.join(rootDirectory, req.path));
  })

exports.app = app;
