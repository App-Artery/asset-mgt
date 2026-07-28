-- DropForeignKey
ALTER TABLE "UserEvent" DROP CONSTRAINT "UserEvent_actorId_fkey";

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
