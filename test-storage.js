import { initializeApp } from "firebase/app";
import { getStorage, ref as storageRef, uploadString } from "firebase/storage";
import fs from "fs";
const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const app = initializeApp(config);
const storage = getStorage(app);
const testRef = storageRef(storage, "test.txt");
uploadString(testRef, "test data").then(() => console.log("Success")).catch(e => console.error("Error:", e));
