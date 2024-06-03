const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const {format} = require('date-fns')
const jwt = require('jsonwebtoken')

const dbPath = path.join('twitterClone.db')
let db = null
const app = express()
app.use(express.json())

const connectDB = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    console.log('Database is connected to')
  } catch (err) {
    console.error('Error at Connection ', err)
    process.exit(1)
  }
}

connectDB()

app.post('/register/', async (req, res) => {
  const {username, password, name, gender} = req.body
  const user = await db.get('SELECT username from user WHERE username = ?', [
    username,
  ])

  if (user) {
    return res.status(400).send('User already exists')
  }

  if (password.length < 6) {
    return res.status(400).send('Password is too short')
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  await db.run(
    'INSERT INTO user (name, username, password, gender) VALUES (?, ?, ?, ?)',
    [name, username, hashedPassword, gender],
  )

  res.status(200).send('User created successfully')
})

app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const user = await db.get('SELECT * FROM user WHERE username = ?', [username])

  if (!user) {
    return res.status(400).send('Invalid user')
  }

  const isPasswordValid = await bcrypt.compare(password, user.password)
  if (!isPasswordValid) {
    return res.status(400).send('Invalid password')
  }

  const payload = {userId: user.user_id, username: user.username}
  const jwtToken = jwt.sign(payload, 'YOUR_SECRET_KEY')
  res.status(200).send({jwtToken})
})

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).send('Invalid JWT Token')
  }

  jwt.verify(token, 'YOUR_SECRET_KEY', (err, user) => {
    if (err) {
      return res.status(401).send('Invalid JWT Token')
    }
    req.user = user
    next()
  })
}

app.get('/user/tweets/feed/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const tweets = await db.all(
    `
    SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM follower
    JOIN tweet ON follower.following_user_id = tweet.user_id
    JOIN user ON tweet.user_id = user.user_id
    WHERE follower.follower_user_id = ?
    ORDER BY tweet.date_time ASC
    LIMIT 4
  `,
    [userId],
  )

  res.status(200).send(tweets)
})

app.get('/user/following/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const following = await db.all(
    `
    SELECT user.name
    FROM follower
    JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = ?
  `,
    [userId],
  )

  res.status(200).send(following)
})

app.get('/user/followers/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const followers = await db.all(
    `
    SELECT user.name
    FROM follower
    JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ?
  `,
    [userId],
  )

  res.status(200).send(followers)
})

app.get('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const {tweetId} = req.params

  const tweet = await db.get(
    `
    SELECT tweet, date_time AS dateTime
    FROM tweet
    WHERE tweet_id = ? AND user_id IN (
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?
    )
  `,
    [tweetId, userId],
  )

  if (!tweet) {
    return res.status(401).send('Invalid Request')
  }

  const likes = await db.get(
    'SELECT COUNT(*) AS likes FROM like WHERE tweet_id = ?',
    [tweetId],
  )
  const replies = await db.get(
    'SELECT COUNT(*) AS replies FROM reply WHERE tweet_id = ?',
    [tweetId],
  )

  res.status(200).send({
    tweet: tweet.tweet,
    likes: likes.likes,
    replies: replies.replies,
    dateTime: tweet.dateTime,
  })
})

app.get('/tweets/:tweetId/likes/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const {tweetId} = req.params

  const tweet = await db.get(
    `
    SELECT tweet_id
    FROM tweet
    WHERE tweet_id = ? AND user_id IN (
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?
    )
  `,
    [tweetId, userId],
  )

  if (!tweet) {
    return res.status(401).send('Invalid Request')
  }

  const likes = await db.all(
    `
    SELECT user.username
    FROM like
    JOIN user ON like.user_id = user.user_id
    WHERE like.tweet_id = ?
  `,
    [tweetId],
  )

  res.status(200).send({likes: likes.map(like => like.username)})
})

app.get('/tweets/:tweetId/replies/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const {tweetId} = req.params

  const tweet = await db.get(
    `
    SELECT tweet_id
    FROM tweet
    WHERE tweet_id = ? AND user_id IN (
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?
    )
  `,
    [tweetId, userId],
  )

  if (!tweet) {
    return res.status(401).send('Invalid Request')
  }

  const replies = await db.all(
    `
    SELECT user.name, reply.reply
    FROM reply
    JOIN user ON reply.user_id = user.user_id
    WHERE reply.tweet_id = ?
  `,
    [tweetId],
  )

  res.status(200).send({
    replies: replies.map(reply => ({name: reply.name, reply: reply.reply})),
  })
})

app.get('/user/tweets/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const tweets = await db.all(
    `
    SELECT tweet.tweet, COUNT(DISTINCT like.like_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ?
    GROUP BY tweet.tweet_id
  `,
    [userId],
  )

  res.status(200).send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const {tweet} = req.body
  const dateTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss')

  await db.run(
    'INSERT INTO tweet (tweet, user_id, date_time) VALUES (?, ?, ?)',
    [tweet, userId, dateTime],
  )

  res.status(200).send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const {userId} = req.user
  const {tweetId} = req.params

  const tweet = await db.get(
    'SELECT tweet_id FROM tweet WHERE tweet_id = ? AND user_id = ?',
    [tweetId, userId],
  )

  if (!tweet) {
    return res.status(401).send('Invalid Request')
  }

  await db.run('DELETE FROM tweet WHERE tweet_id = ?', [tweetId])

  res.status(200).send('Tweet Removed')
})

module.exports = app
