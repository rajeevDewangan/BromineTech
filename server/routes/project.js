const express = require('express');
const router = express.Router();
const { requiresAuth } = require('express-openid-connect');
const insertIntoUser = require('../middlewares/insertIntoUser');
const sql = require('../dbConfig');

// Get all projects
router.get('/all', requiresAuth(), insertIntoUser, async (req, res) => {
  const email = req.oidc.user.email;
  try {
    const allProjects = await sql`
      SELECT p."ProjectName"
      FROM "User" u
      JOIN "Member" m ON u."UserId" = m."UserId"
      JOIN "Project" p ON m."ProjectId" = p."ProjectId"
      WHERE u."Email" = ${email};
    `;
    res.json(allProjects);
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create a new project
router.post('/createproject', requiresAuth(), async (req, res) => {
  const email = req.oidc.user.email;
  const { ProjectName } = req.body;
  const memberRole = 'Admin';
  try {
    const getUserId = await sql`
      SELECT "UserId"
      FROM "User"
      WHERE "Email" = ${email};
    `;
    const userId = getUserId[0]?.UserId;
    if (!userId) throw new Error('User not found');

    const insertIntoProject = await sql`
      INSERT INTO "Project" ("ProjectId", "ProjectName")
      VALUES (uuid_generate_v4(), ${ProjectName})
      RETURNING "ProjectId";
    `;
    const projectId = insertIntoProject[0]?.ProjectId;
    if (!projectId) throw new Error('Project insertion failed');

    await sql`
      INSERT INTO "Member" ("MemberId", "UserId", "ProjectId", "MemberRole")
      VALUES (uuid_generate_v4(), ${userId}, ${projectId}, ${memberRole});
    `;
    res.redirect(`/project/${projectId}/overview`);
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get project overview
router.get('/:projectId/overview', requiresAuth(), async (req, res) => {
  const email = req.oidc.user.email;
  const { projectId } = req.params;
  try {
    const result = await sql`
      SELECT 
        p."ProjectId", p."ProjectName", p."ProjectDescription", p."ProjectStatus",
        p."ProjectTarget", p."ProjectStart", m."MilestoneId", m."MilestoneName",
        m."MilestoneTarget", l."LinkId", l."InfoLink"
      FROM "User" u
      JOIN "Member" mb ON u."UserId" = mb."UserId"
      JOIN "Project" p ON mb."ProjectId" = p."ProjectId"
      LEFT JOIN "Milestone" m ON p."ProjectId" = m."ProjectId"
      LEFT JOIN "Link" l ON p."ProjectId" = l."ProjectId"
      WHERE u."Email" = ${email} AND p."ProjectId" = ${projectId};
    `;
    
    res.json(result);
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get project issues
router.get('/:projectId/issues', requiresAuth(), async (req, res) => {
  const email = req.oidc.user.email;
  const { projectId } = req.params;
  try {
    const result = await sql`
      SELECT 
        i."IssueId", i."IssueName", i."IssueStatus", i."IssueLabel", m."MilestoneName",
        m."MilestoneId", i."Assigned", i."SubIssueOf"
      FROM "User" u
      JOIN "Member" mb ON u."UserId" = mb."UserId"
      JOIN "Project" p ON mb."ProjectId" = p."ProjectId"
      JOIN "Issue" i ON p."ProjectId" = i."ProjectId"
      LEFT JOIN "Milestone" m ON i."MilestoneId" = m."MilestoneId"
      WHERE u."Email" = ${email} AND p."ProjectId" = ${projectId};
    `;
    res.status(200).json(result);
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get specific issue details
router.get('/:projectId/issue/:issueId', requiresAuth(), async (req, res) => {
  const email = req.oidc.user.email;
  const { projectId, issueId } = req.params;
  try {
    const result = await sql`
      SELECT 
        i."IssueId", i."IssueName", i."IssueStatus", i."IssueLabel", m."MilestoneName",
        m."MilestoneId", i."Assigned", i."SubIssueOf", a."ActivityId", a."ActivityDesc",
        a."ReplyTo", a."MemberId", a."ActivityTime", u2."UserName" AS "ActivityUserName"
      FROM "User" u
      JOIN "Member" mb ON u."UserId" = mb."UserId"
      JOIN "Project" p ON mb."ProjectId" = p."ProjectId"
      JOIN "Issue" i ON p."ProjectId" = i."ProjectId"
      LEFT JOIN "Milestone" m ON i."MilestoneId" = m."MilestoneId"
      JOIN "Activity" a ON i."IssueId" = a."IssueId"
      JOIN "Member" mb2 ON a."MemberId" = mb2."MemberId"
      JOIN "User" u2 ON mb2."UserId" = u2."UserId"
      WHERE u."Email" = ${email} AND p."ProjectId" = ${projectId} AND i."IssueId" = ${issueId};
    `;
    res.status(200).json(result);
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Add a new member to a project
router.post('/:projectId/addmember', requiresAuth(), async (req, res) => {
  const inviterEmail = req.oidc.user.email;
  const { projectId } = req.params;
  const { inviteeEmail, invitedForRole = 'Guest' } = req.body;
  try {
    const inviterMember = await sql`
      SELECT m."MemberId"
      FROM "Member" m
      JOIN "User" u ON m."UserId" = u."UserId"
      WHERE u."Email" = ${inviterEmail} AND m."ProjectId" = ${projectId};
    `;
    const inviterMemberId = inviterMember[0]?.MemberId;
    if (!inviterMemberId) throw new Error('Member not found');

    await sql`
      INSERT INTO "Invites" ("InvitesId", "InvitedBy", "InvitedToProjectId", "InvitedEmail", "InvitedForRole")
      VALUES (uuid_generate_v4(), ${inviterMemberId}, ${projectId}, ${inviteeEmail}, ${invitedForRole})
      RETURNING "InvitesId";
    `;
    // Email logic to send invitation goes here
    res.status(200).json({ success: 'Invite sent' });
  } catch (err) {
    console.error('Error executing query', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Handle invite acceptance
router.get('/invite/:inviteId', requiresAuth(), insertIntoUser, async (req, res) => {
  const { inviteId } = req.params;
  const email = req.oidc.user.email;
  try {
    const emailInInvitesTable = await sql`
      SELECT "InvitedEmail", "InvitedForRole", "InvitedToProjectId"
      FROM "Invites"
      WHERE "InvitesId" = ${inviteId};
    `;
    if (emailInInvitesTable[0]?.InvitedEmail === email) {
      const { InvitedForRole: invitedForRole, InvitedToProjectId: projectId } = emailInInvitesTable[0];
      const getUserId = await sql`
        SELECT "UserId"
        FROM "User"
        WHERE "Email" = ${email};
      `;
      const userId = getUserId[0]?.UserId;
      await sql`
        INSERT INTO "Member" ("MemberId", "UserId", "ProjectId", "MemberRole")
        VALUES (uuid_generate_v4(), ${userId}, ${projectId}, ${invitedForRole});
      `;
      res.redirect(`/project/${projectId}/overview`);
    } else {
      res.redirect(`/project/all`);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;