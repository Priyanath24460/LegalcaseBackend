import express from "express";
import { searchQuestion, rewriteUserQuestion } from "../controllers/queryController.js";

const router = express.Router();

router.post("/", searchQuestion);
router.post("/rewrite", rewriteUserQuestion);

export default router;
