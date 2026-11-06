-- CreateTable
CREATE TABLE "citizen_feedback" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "credential" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citizen_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_id_verifications" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "protocol_version" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback_id" TEXT NOT NULL,

    CONSTRAINT "world_id_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "citizen_feedback_chain_id_contract_project_id_created_at_idx" ON "citizen_feedback"("chain_id", "contract", "project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "world_id_verifications_feedback_id_key" ON "world_id_verifications"("feedback_id");

-- CreateIndex
CREATE UNIQUE INDEX "world_id_verifications_action_nullifier_key" ON "world_id_verifications"("action", "nullifier");

-- AddForeignKey
ALTER TABLE "world_id_verifications" ADD CONSTRAINT "world_id_verifications_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "citizen_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
