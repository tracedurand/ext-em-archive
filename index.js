const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const unzip = require('unzip');

// Load the SDK and UUID
const AWS = require('aws-sdk');

//npm install jsforce
const jsforce = require('jsforce');
 
const csv = require('csv'); 

//For deleting directory.
const rimraf = require('rimraf');

const PORT = process.env.PORT || 8080;

const app = express();

app.use(express.static(path.join(__dirname, 'public')))
app.use(bodyParser.urlencoded({ extended: false }));
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
   
app.get('/', (req, res) => {
    console.log("default route called");

    res.render('pages/index');
});

app.post('/ftpfile', (req, res) => {
    console.log("ftpfile called");

    const postBody = req.body;
    console.log(postBody); 

    console.log('request.body.ftpusername: ' + req.body.ftpusername);

    if (fs.existsSync('./zip_dir')) { 
        //fall through.
        console.log('zip_dir already exists.');
    }
    else
    {
        fs.mkdirSync('./zip_dir');
        console.log('directory does not exist');
    }

    //https://github.com/mscdex/ssh2
    //npm install ssh2
    var Client = require('ssh2').Client;
    var connSettings = {
    host: req.body.ftpserver,
    port: 22, // Normal is 22 port
    username: req.body.ftpusername,
    password: req.body.ftppassword,
    algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-dss']
        }
    };

    var conn = new Client();
    conn.on('ready', function() {
        conn.sftp(function(err, sftp) {
            if (err) throw err;
            
            var moveFrom = req.body.ftpsourcefile //"/EmailArchive/DateTime-2019_1_14_15_28-Client-1345408-Job-1392012-Batch-295-List-3217.zip";
            var moveTo = "./zip_dir/myfile.zip";

            sftp.fastGet(moveFrom, moveTo , {}, function(downloadError){
                if(downloadError) throw downloadError;

                console.log("Succesfully downloaded file.");

                //close the ftp connection.
                conn.end();

                //load a page
                res.redirect('/');
            });
        });
    }).connect(connSettings);
  });

  app.post('/unzipfile', (req, res) => {
        console.log("unzipfile called");

        //Unzip the file
        //npm install unzip
        //https://www.npmjs.com/package/unzip
        fs.createReadStream('./zip_dir/myfile.zip').pipe(unzip.Extract({ path: './zip_dir/myfiles' }));

        console.log("Succesfully extracted the file.");
        //load a page
        res.redirect('/');
  });

  app.post('/movefilestoS3', (req, res) => {
    console.log("movefilestoS3 called");

    var fromDir = './zip_dir/myfiles/';

    // Loop through all the files in the temp directory
    fs.readdir(fromDir, function (err, files) {
        if (err) {
        console.error("Could not list the directory.", err);
        process.exit(1);
        }

        var s3 = new AWS.S3({
            accessKeyId: req.body.accesskeyid, 
            secretAccessKey: req.body.secretaccesskey 
        });

        files.forEach(function (file, index) {
        var fromDirAndFile = path.join(fromDir, file);
    
        fs.stat(fromDirAndFile, function (error, stat) {
            if (error) {
            console.error("Error stating file.", error);
            return;
            }
    
            if (stat.isFile()){
            console.log("'%s' is a file.", fromDirAndFile);
            if (path.extname(file) == ".eml" || path.extname(file) == ".html")
            {
                console.log("file is .eml or .html.  Upload it.");
                uploadToS3(fromDir, file, s3);
            }
            else
            {console.log("file is NOT .eml or .html.  SKIP it.");}
            }
            
        });
        });
    });

    //load a page
    res.redirect('/');
                
  }); 
  
  app.post('/createSFObjects', (req, res) => {
        console.log("createSFObjects called");

        var conn = new jsforce.Connection({
            oauth2 : {
            // you can change loginUrl to connect to sandbox or prerelease env.
            loginUrl : 'https://login.salesforce.com',
            grant_type : 'password',
            
            //Cumulus 2
            clientId : req.body.clientid,
            clientSecret : req.body.clientsecret,        
            
            redirectUri : 'http://localhost:8080/oauth/callback'
            }
        });
        
        console.log("before login"); 

        conn.login(req.body.username, req.body.password + req.body.securitytoken, function(err, userInfo) {
        if (err) { return console.error(err); }
        // Now you can get the access token and instance URL information.
        // Save them to establish connection next time.
        console.log('Access Token: ' + conn.accessToken);
        console.log('Instance URL: ' + conn.instanceUrl);
        // logged in user property
        console.log("User ID: " + userInfo.id);
        console.log("Org ID: " + userInfo.organizationId);
        
        //single object.
        /*conn.sobject("Email_Archive__c").create(
            { 
                Name : 'Test Name',
                Filename__c : 'abc.html',
                Contact__c : '003f400000MBO4aAAH' //Barry Brown Contact
            }, function(err, ret) {
            if (err || !ret.success) { return console.error(err, ret); }
            console.log("Created record id : " + ret.id);
            // ...
            });*/
        //end single object

        /*
        var emailarchives = [
        { Name : 'Email Archive #1',
            Filename__c : 'abc.html',
            JobID__c : '876',
            Contact__c : '003f400000bkJUuAAM'
            },
            { Name : 'Email Archive #2',
            Filename__c : 'xyz.html',
            JobID__c : '999',
            Contact__c : '003f400000bkJUuAAM'
        }
        
        ];
        */
        var csvReader = csv();

        //Create the emailarchives object
        var emailarchives = [];
        
        //Read the index.csv file.
        csvReader.from.path('./zip_dir/myfiles/index.csv').to.array(function (data) {
        //Don't start with 0 (this is the header row).  Instead, start with 1, the first row of actual data.
        for (var index = 1; index < data.length; index++) {
            emailarchives.push(new emailarchive(data[index][0], data[index][1], data[index][2], data[index][3], data[index][4], data[index][5], data[index][6], data[index][7], data[index][8], data[index][9]));
        }
        console.log(emailarchives);
        
        //Call the Salesforce Bulk API to insert all email archive objects into the Org.
        conn.bulk.pollTimeout = 25000; // Bulk timeout can be specified globally on the connection object
        conn.bulk.load("Email_Archive__c", "insert", emailarchives, function(err, rets) {
            if (err) { return console.error(err); }
            for (var i=0; i < rets.length; i++) {
            if (rets[i].success) {
                console.log("#" + (i+1) + " loaded successfully, id = " + rets[i].id);
            } else {
                console.log("#" + (i+1) + " error occurred, message = " + rets[i].errors.join(', '));
            }
            }
        });            
    }); 

/*
    //Cannot use the csv file as a source because the field names do not match what is in Salesforce.
        var csvFileIn = fs.createReadStream("./zip_dir/myfiles/index.csv");
        //
        // Call Bulk#load(sobjectType, operation, input) - use CSV file stream as "input" argument
        //
        conn.bulk.load("Email_Archive__c", "insert", csvFileIn, function(err, rets) {
        if (err) { return console.error(err); }
        for (var i=0; i < rets.length; i++) {
            if (rets[i].success) {
            console.log("#" + (i+1) + " loaded successfully, id = " + rets[i].id);
            } else {
            console.log("#" + (i+1) + " error occurred, message = " + rets[i].errors.join(', '));
            }
        }
        // ...
        });
        */ 
    }); //end conn.login()

    res.redirect('/');
});

app.post('/deleteTempFiles', (req, res) => {
    console.log("deleteTempFiles called");

    var zipFile = './zip_dir/myfile.zip';
    var sourcePath = './zip_dir/myfiles';

    //Delete the zip file if it exists.
    if (fs.existsSync(zipFile)) {
        fs.unlink(zipFile, (err) => {
            if (err) throw err;
            console.log(zipFile + ' was deleted');
          }); 
    }

    if (fs.existsSync(sourcePath)) {
        rimraf(sourcePath, function(error) {
            if (error == null)
            {console.log('Folder deleted')} else
            {console.log('Error: ', error);}
        });
    }
    else
    {
        console.log('directory does not exist');
    }

    res.redirect('/');
});

app.listen(PORT, () => console.log(`Listening on ${ PORT }`));

function uploadToS3(sourceDirectory, fileName, s3)
{
    var dirAndFile = sourceDirectory + fileName;
    console.log('Directory and Filename: ' + dirAndFile);

    //Upload files to S3
    //npm install aws-sdk and npm install uuid
    //https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-started-nodejs.html
    fs.readFile(dirAndFile, function (err, data) {
        if (err) throw err; // Something went wrong.

        //Have to add ContentType/ContentDisposition for the html files so they display on screen, and don't download.
        //Do not need these properties on the .eml files.
        if (path.extname(fileName) == ".html")
        {
            var params = {
                Bucket: 'cloud-cube',
                ContentType: 'text/html', //Need this for .html files so they will render in the Salesforce Org.  Likely not needed for .eml files.
                ContentDisposition: 'inline',
                Key: 'yjf1zspt74o6/public/' + fileName, 
                Body: data
            };
        }
        else
        {
            var params = {
                Bucket: 'cloud-cube',
                Key: 'yjf1zspt74o6/public/' + fileName, 
                Body: data
            };
        }   
        s3.upload(params, function (err, data) {
            
            if (err) {
                console.log('ERROR MSG: ', err);
            } else {
                console.log('Successfully uploaded data');
            }
        });
    });
}

function emailarchive(Filename, ListID, LastName, FirstName, JobID, Id, BatchID, PersonEmail, SendDate, SubID) {

    this.Name = Filename;
    this.ListID__c = ListID
    this.Filename__c = Filename;
    this.Last_Name__c = LastName;
    this.First_Name__c = FirstName;
    this.JobID__c = JobID;
    this.Contact__c = Id;
    this.BatchID__c = BatchID;
    this.Email__c = PersonEmail;

    sendDate = new Date(SendDate).toISOString();
    console.log ('Passed In Send Date: ' + SendDate);
    console.log ('Converted Send Date: ' + sendDate);
    this.Send_Date__c = sendDate;
    
    this.SubID__c = SubID
}